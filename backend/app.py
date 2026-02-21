# ============================================================
#                        IMPORTS
# ============================================================

import os
import json
from flask import Flask, request, jsonify
from flask_cors import CORS
from database import get_connection
from init_db import initialize_database

from flask_jwt_extended import (
    JWTManager,
    create_access_token,
    jwt_required,
)

from flask_socketio import SocketIO
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_caching import Cache

# ============================================================
#                        APP INITIALIZATION
# ============================================================

app = Flask(__name__)

# 🔥 Initialize database automatically on startup
initialize_database()

limiter = Limiter(
    get_remote_address,
    app=app,
    default_limits=["200 per day", "50 per hour"]
)

# ✅ Cache config (simple in-memory cache, swap to Redis if available)
app.config["CACHE_TYPE"] = os.getenv("CACHE_TYPE", "SimpleCache")
app.config["CACHE_REDIS_URL"] = os.getenv("REDIS_URL", None)
app.config["CACHE_DEFAULT_TIMEOUT"] = 10   # seconds — short TTL for live data
if app.config["CACHE_TYPE"] == "RedisCache" and app.config["CACHE_REDIS_URL"]:
    app.config["CACHE_TYPE"] = "RedisCache"
cache = Cache(app)

# ✅ Updated frontend URL for Render deployment
FRONTEND_URL = os.getenv("FRONTEND_URL", "*")

CORS(
    app,
    resources={r"/*": {"origins": FRONTEND_URL}},
    supports_credentials=True,
)

app.config["JWT_SECRET_KEY"] = os.getenv("JWT_SECRET_KEY", "super-secret-key")
app.config["JWT_ACCESS_TOKEN_EXPIRES"] = 3600   # 1 hour — avoids repeated re-auth
jwt = JWTManager(app)

# ✅ eventlet/gevent is faster than threading on Render — set ASYNC_MODE env var
socketio = SocketIO(
    app,
    cors_allowed_origins=FRONTEND_URL,
    async_mode=os.getenv("ASYNC_MODE", "threading"),
    ping_timeout=20,
    ping_interval=10,
)


# ============================================================
#                        HELPERS
# ============================================================

def parse_items(rows):
    """Parse JSON items field in place for a list of order dicts."""
    for row in rows:
        if row.get("items"):
            row["items"] = json.loads(row["items"])
        else:
            row["items"] = []
    return rows


# ============================================================
#                        ROUTES
# ============================================================

@app.route("/tables", methods=["GET"])
@cache.cached(timeout=5, key_prefix="all_tables")   # ✅ cache tables for 5s
def get_tables():
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM tables")
        return jsonify(cursor.fetchall())
    finally:
        conn.close()


@app.route("/orders", methods=["POST"])
def create_order():
    conn = None
    try:
        data = request.get_json()

        if not data:
            return jsonify({"error": "Invalid JSON"}), 400

        session_id = data.get("session_id")
        if not session_id:
            return jsonify({"error": "Session ID missing"}), 400

        table_id = data.get("table_id")
        items    = json.dumps(data.get("items", []))
        total    = data.get("total", 0)

        conn = get_connection()
        cursor = conn.cursor()

        # ✅ Single round-trip: insert + update in one transaction
        cursor.execute("""
            INSERT INTO orders 
            (table_id, items, total, status, customer_name, whatsapp, session_id)
            VALUES (%s, %s, %s, 'pending', %s, %s, %s)
        """, (
            table_id, items, total,
            data.get("customer_name"),
            data.get("whatsapp"),
            session_id,
        ))

        cursor.execute(
            "UPDATE tables SET status='reserved' WHERE id=%s",
            (table_id,)
        )

        conn.commit()

        # ✅ Invalidate caches that depend on orders/tables
        cache.delete("all_tables")
        cache.delete("total_income")

        socketio.emit("new_order", {"message": "New order received"}, broadcast=True)

        return jsonify({"message": "Order created successfully"}), 201

    except Exception as e:
        if conn:
            conn.rollback()
        return jsonify({"error": str(e)}), 500

    finally:
        if conn:
            conn.close()


@app.route("/orders/session/<session_id>", methods=["GET"])
def get_session_orders(session_id):
    conn = get_connection()
    try:
        cursor = conn.cursor()
        # ✅ Only fetch needed columns
        cursor.execute(
            """SELECT id, table_id, items, total, status, customer_name, whatsapp,
                      session_id, created_at
               FROM orders WHERE session_id=%s ORDER BY created_at ASC""",
            (session_id,)
        )
        return jsonify(parse_items(cursor.fetchall()))
    finally:
        conn.close()


@app.route("/orders", methods=["GET"])
@jwt_required()
@cache.cached(timeout=5, key_prefix="all_orders")   # ✅ short cache for admin view
def get_orders():
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM orders ORDER BY created_at DESC")
        return jsonify(parse_items(cursor.fetchall()))
    finally:
        conn.close()


@app.route("/orders/table/<int:table_id>", methods=["GET"])
def get_orders_by_table(table_id):
    session_id = request.args.get("session_id")
    if not session_id:
        return jsonify([])

    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, table_id, items, total, status, customer_name, whatsapp,
                   session_id, created_at
            FROM orders
            WHERE table_id=%s AND session_id=%s
            ORDER BY id ASC
        """, (table_id, session_id))
        return jsonify(parse_items(cursor.fetchall()))
    finally:
        conn.close()


@app.route("/orders/<int:order_id>", methods=["PUT"])
@jwt_required()
def update_order_status(order_id):
    data = request.get_json()

    if not data or "status" not in data:
        return jsonify({"error": "Status required"}), 400

    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE orders SET status=%s WHERE id=%s",
            (data["status"], order_id)
        )
        conn.commit()

        cache.delete("all_orders")
        socketio.emit("order_updated", {"order_id": order_id}, broadcast=True)
        return jsonify({"message": "Status updated"})
    finally:
        conn.close()


@app.route("/orders/<int:order_id>/pay", methods=["PUT"])
@jwt_required()
def mark_paid(order_id):
    conn = get_connection()
    try:
        cursor = conn.cursor()
        # ✅ Single query: update order AND get table_id in one shot (PostgreSQL RETURNING)
        cursor.execute(
            "UPDATE orders SET status='paid' WHERE id=%s RETURNING table_id",
            (order_id,)
        )
        row = cursor.fetchone()

        if not row:
            return jsonify({"error": "Order not found"}), 404

        table_id = row["table_id"]

        cursor.execute(
            "UPDATE tables SET status='free' WHERE id=%s",
            (table_id,)
        )
        conn.commit()

        # ✅ Invalidate relevant caches
        cache.delete("all_tables")
        cache.delete("all_orders")
        cache.delete("total_income")

        socketio.emit("order_updated", {"order_id": order_id}, broadcast=True)
        socketio.emit("table_updated", {"table_id": table_id}, broadcast=True)

        return jsonify({"message": "Order paid & table freed"})
    finally:
        conn.close()


@app.route("/tables/<int:table_id>", methods=["PUT"])
@jwt_required()
def update_table_status(table_id):
    data = request.get_json()

    if not data or "status" not in data:
        return jsonify({"error": "Status required"}), 400

    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE tables SET status=%s WHERE id=%s",
            (data["status"], table_id)
        )
        conn.commit()

        cache.delete("all_tables")
        socketio.emit("table_updated", {"table_id": table_id}, broadcast=True)
        return jsonify({"message": "Table status updated"})
    finally:
        conn.close()


@app.route("/income", methods=["GET"])
@jwt_required()
@cache.cached(timeout=30, key_prefix="total_income")   # ✅ income is slow-changing
def total_income():
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT SUM(total) AS income FROM orders WHERE status='paid'")
        row = cursor.fetchone()
        return jsonify({
            "total_income": row["income"] if row and row["income"] else 0
        })
    finally:
        conn.close()


# ============================================================
#                        ADMIN LOGIN
# ============================================================

@app.route("/admin/login", methods=["POST"])
@limiter.limit("10 per minute")   # ✅ brute-force protection
def admin_login():
    data = request.get_json()

    if not data or not data.get("username") or not data.get("password"):
        return jsonify({"message": "Username and password required"}), 400

    username = data.get("username")
    password = data.get("password")

    ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "SHUBHAM")
    ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "8830146272")

    if username == ADMIN_USERNAME and password == ADMIN_PASSWORD:
        access_token = create_access_token(identity=username)
        return jsonify({"access_token": access_token}), 200

    return jsonify({"message": "Invalid credentials"}), 401


# ============================================================
#                        HEALTH CHECK
# ============================================================

@app.route("/health", methods=["GET"])
def health_check():
    return jsonify({"status": "API is running"}), 200


# ============================================================
#                        RUN LOCAL
# ============================================================

if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    socketio.run(app, host="0.0.0.0", port=port, debug=False)
