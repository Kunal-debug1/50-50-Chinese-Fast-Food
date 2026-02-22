# ============================================================
#                 EVENTLET MONKEY PATCH
#       Must be first lines before ANY other import
# ============================================================
import eventlet
eventlet.monkey_patch()

# ============================================================
#                        IMPORTS
# ============================================================

import os
import json
from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_jwt_extended import JWTManager, create_access_token, jwt_required
from flask_socketio import SocketIO
from flask_caching import Cache

from database import get_connection, release_connection
from init_db import initialize_database


# ============================================================
#                     APP & CONFIG
# ============================================================

app = Flask(__name__)

FRONTEND_URL = os.getenv("FRONTEND_URL", "*")

app.config.update(
    JWT_SECRET_KEY           = os.getenv("JWT_SECRET_KEY", "super-secret-key"),
    JWT_ACCESS_TOKEN_EXPIRES = 3600,
    CACHE_TYPE               = "SimpleCache",
    CACHE_DEFAULT_TIMEOUT    = 5,       # 5s default — fresh but fast
    JSON_SORT_KEYS           = False,   # ✅ skip sorting JSON keys = faster responses
    PROPAGATE_EXCEPTIONS     = True,
)

# ============================================================
#                     EXTENSIONS
# ============================================================

CORS(app, resources={r"/*": {"origins": FRONTEND_URL}}, supports_credentials=True)

jwt      = JWTManager(app)
cache    = Cache(app)

socketio = SocketIO(
    app,
    cors_allowed_origins=FRONTEND_URL,
    async_mode="eventlet",
    ping_timeout=20,
    ping_interval=10,
    logger=False,       # ✅ no logging overhead
    engineio_logger=False,
)

# ============================================================
#                    DATABASE INIT
# ============================================================

initialize_database()


# ============================================================
#                       HELPERS
# ============================================================

def parse_items(rows):
    """Parse items JSON string → list for each order row."""
    for row in rows:
        row["items"] = json.loads(row["items"]) if row.get("items") else []
    return rows


def emit(event, data):
    """Helper to emit socket events safely."""
    try:
        socketio.emit(event, data, broadcast=True)
    except Exception:
        pass


# ============================================================
#                   ROUTES — TABLES
# ============================================================

@app.route("/tables", methods=["GET"])
@cache.cached(timeout=5, key_prefix="all_tables")
def get_tables():
    conn = get_connection()
    try:
        cursor = conn.cursor()
        # ✅ Only fetch columns we need
        cursor.execute("SELECT id, number, status FROM tables ORDER BY id ASC")
        return jsonify(cursor.fetchall())
    finally:
        release_connection(conn)


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
        emit("table_updated", {"table_id": table_id})
        return jsonify({"message": "Table status updated"})
    finally:
        release_connection(conn)


# ============================================================
#                   ROUTES — ORDERS
# ============================================================

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

        conn = get_connection()
        cursor = conn.cursor()

        # ✅ Both inserts in one transaction — single commit
        cursor.execute("""
            INSERT INTO orders
                (table_id, items, total, status, customer_name, whatsapp, session_id)
            VALUES (%s, %s, %s, 'pending', %s, %s, %s)
            RETURNING id
        """, (
            table_id,
            json.dumps(data.get("items", [])),
            data.get("total", 0),
            data.get("customer_name"),
            data.get("whatsapp"),
            session_id,
        ))

        order_id = cursor.fetchone()["id"]

        cursor.execute(
            "UPDATE tables SET status='reserved' WHERE id=%s",
            (table_id,)
        )
        conn.commit()

        cache.delete_many("all_tables", "all_orders", "total_income")
        emit("new_order", {"message": "New order received", "order_id": order_id})

        return jsonify({"message": "Order created successfully", "order_id": order_id}), 201

    except Exception as e:
        if conn:
            conn.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        if conn:
            release_connection(conn)


@app.route("/orders", methods=["GET"])
@jwt_required()
@cache.cached(timeout=5, key_prefix="all_orders")
def get_orders():
    conn = get_connection()
    try:
        cursor = conn.cursor()
        # ✅ Uses idx_orders_created_at index
        cursor.execute("""
            SELECT id, table_id, items, total, status,
                   customer_name, whatsapp, session_id, created_at
            FROM orders
            ORDER BY created_at DESC
        """)
        return jsonify(parse_items(cursor.fetchall()))
    finally:
        release_connection(conn)


@app.route("/orders/session/<session_id>", methods=["GET"])
def get_session_orders(session_id):
    conn = get_connection()
    try:
        cursor = conn.cursor()
        # ✅ Uses idx_orders_session_id index
        cursor.execute("""
            SELECT id, table_id, items, total, status,
                   customer_name, whatsapp, session_id, created_at
            FROM orders
            WHERE session_id = %s
            ORDER BY created_at ASC
        """, (session_id,))
        return jsonify(parse_items(cursor.fetchall()))
    finally:
        release_connection(conn)


@app.route("/orders/table/<int:table_id>", methods=["GET"])
def get_orders_by_table(table_id):
    session_id = request.args.get("session_id")
    if not session_id:
        return jsonify([])

    conn = get_connection()
    try:
        cursor = conn.cursor()
        # ✅ Uses idx_orders_table_session composite index
        cursor.execute("""
            SELECT id, table_id, items, total, status,
                   customer_name, whatsapp, session_id, created_at
            FROM orders
            WHERE table_id = %s AND session_id = %s
            ORDER BY id ASC
        """, (table_id, session_id))
        return jsonify(parse_items(cursor.fetchall()))
    finally:
        release_connection(conn)


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
        emit("order_updated", {"order_id": order_id})
        return jsonify({"message": "Status updated"})
    finally:
        release_connection(conn)


@app.route("/orders/<int:order_id>/pay", methods=["PUT"])
@jwt_required()
def mark_paid(order_id):
    conn = get_connection()
    try:
        cursor = conn.cursor()
        # ✅ RETURNING avoids a second SELECT query
        cursor.execute(
            "UPDATE orders SET status='paid' WHERE id=%s RETURNING table_id",
            (order_id,)
        )
        row = cursor.fetchone()
        if not row:
            return jsonify({"error": "Order not found"}), 404

        table_id = row["table_id"]
        cursor.execute("UPDATE tables SET status='free' WHERE id=%s", (table_id,))
        conn.commit()

        cache.delete_many("all_tables", "all_orders", "total_income")
        emit("order_updated", {"order_id": order_id})
        emit("table_updated", {"table_id": table_id})

        return jsonify({"message": "Order paid & table freed"})
    finally:
        release_connection(conn)


# ============================================================
#                   ROUTES — INCOME
# ============================================================

@app.route("/income", methods=["GET"])
@jwt_required()
@cache.cached(timeout=30, key_prefix="total_income")
def total_income():
    conn = get_connection()
    try:
        cursor = conn.cursor()
        # ✅ Uses idx_orders_status index
        cursor.execute(
            "SELECT COALESCE(SUM(total), 0) AS income FROM orders WHERE status='paid'"
        )
        row = cursor.fetchone()
        return jsonify({"total_income": float(row["income"])})
    finally:
        release_connection(conn)


# ============================================================
#                   ROUTES — ADMIN LOGIN
# ============================================================

@app.route("/admin/login", methods=["POST"])
def admin_login():
    data = request.get_json()
    if not data or not data.get("username") or not data.get("password"):
        return jsonify({"message": "Username and password required"}), 400

    ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "SHUBHAM")
    ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "8830146272")

    if data["username"] == ADMIN_USERNAME and data["password"] == ADMIN_PASSWORD:
        token = create_access_token(identity=data["username"])
        return jsonify({"access_token": token}), 200

    return jsonify({"message": "Invalid credentials"}), 401


# ============================================================
#                   HEALTH CHECK
# ============================================================

@app.route("/health", methods=["GET"])
def health_check():
    return jsonify({"status": "API is running"}), 200


# ============================================================
#                   RUN LOCAL
# ============================================================

if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    socketio.run(app, host="0.0.0.0", port=port, debug=False)
