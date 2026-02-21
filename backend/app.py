# ============================================================
#                        IMPORTS
# ============================================================

import os
from flask import Flask, request, jsonify
from flask_cors import CORS
from database import get_connection
import json

from flask_jwt_extended import (
    JWTManager,
    create_access_token,
    jwt_required,
)

from flask_socketio import SocketIO
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from apscheduler.schedulers.background import BackgroundScheduler
from werkzeug.security import check_password_hash


# ============================================================
#                        APP INITIALIZATION
# ============================================================

app = Flask(__name__)

# -------------------- RATE LIMITER --------------------
limiter = Limiter(
    get_remote_address,
    app=app,
    default_limits=["200 per day", "50 per hour"]
)

# -------------------- CORS CONFIG --------------------
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")

CORS(
    app,
    resources={r"/*": {"origins": FRONTEND_URL}},
    supports_credentials=True,
)

# -------------------- JWT CONFIG --------------------
app.config["JWT_SECRET_KEY"] = os.getenv("JWT_SECRET_KEY", "super-secret-key")
jwt = JWTManager(app)

# -------------------- SOCKET.IO --------------------
socketio = SocketIO(
    app,
    cors_allowed_origins=FRONTEND_URL,
)

# ============================================================
#                        ROUTES
# ============================================================

@app.route("/tables", methods=["GET"])
def get_tables():
    conn = get_connection()
    try:
        tables = conn.execute("SELECT * FROM tables").fetchall()
        return jsonify(tables)
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

        conn = get_connection()
        cursor = conn.cursor()

        cursor.execute("""
            INSERT INTO orders 
            (table_id, items, total, status, customer_name, whatsapp, session_id)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
        """, (
            data.get("table_id"),
            json.dumps(data.get("items", [])),
            data.get("total", 0),
            "pending",
            data.get("customer_name"),
            data.get("whatsapp"),
            session_id
        ))

        cursor.execute(
            "UPDATE tables SET status='reserved' WHERE id=%s",
            (data.get("table_id"),)
        )

        conn.commit()

        return jsonify({"message": "Order created successfully"}), 201

    except Exception as e:
        if conn:
            conn.rollback()
        print("ORDER ERROR:", e)
        return jsonify({"error": str(e)}), 500

    finally:
        if conn:
            conn.close()


@app.route("/orders/session/<session_id>", methods=["GET"])
def get_session_orders(session_id):
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM orders WHERE session_id=%s ORDER BY created_at ASC",
            (session_id,)
        )
        orders = cursor.fetchall()

        for order in orders:
            order["items"] = json.loads(order["items"]) if order.get("items") else []

        return jsonify(orders)
    finally:
        conn.close()


@app.route("/orders", methods=["GET"])
@jwt_required()
def get_orders():
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM orders")
        rows = cursor.fetchall()

        for order in rows:
            order["items"] = json.loads(order["items"]) if order.get("items") else []

        return jsonify(rows)
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
            SELECT * FROM orders
            WHERE table_id=%s AND session_id=%s
            ORDER BY id ASC
        """, (table_id, session_id))

        rows = cursor.fetchall()

        for order in rows:
            order["items"] = json.loads(order["items"]) if order.get("items") else []

        return jsonify(rows)
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
        conn.execute(
            "UPDATE orders SET status=%s WHERE id=%s",
            (data["status"], order_id)
        )
        conn.commit()

        socketio.emit("order_updated", {"order_id": order_id})

        return jsonify({"message": "Status updated"})
    finally:
        conn.close()


@app.route("/orders/<int:order_id>/pay", methods=["PUT"])
@jwt_required()
def mark_paid(order_id):
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT table_id FROM orders WHERE id=%s",
            (order_id,)
        )
        order = cursor.fetchone()

        if not order:
            return jsonify({"error": "Order not found"}), 404

        table_id = order["table_id"]

        conn.execute("UPDATE orders SET status='paid' WHERE id=%s", (order_id,))
        conn.execute("UPDATE tables SET status='free' WHERE id=%s", (table_id,))
        conn.commit()

        socketio.emit("order_updated", {"order_id": order_id})
        socketio.emit("table_updated", {"table_id": table_id})

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
        conn.execute(
            "UPDATE tables SET status=%s WHERE id=%s",
            (data["status"], table_id)
        )
        conn.commit()

        socketio.emit("table_updated", {"table_id": table_id})

        return jsonify({"message": "Table status updated"})
    finally:
        conn.close()


@app.route("/income", methods=["GET"])
@jwt_required()
def total_income():
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT SUM(total) as income 
            FROM orders 
            WHERE status='paid'
        """)
        row = cursor.fetchone()

        return jsonify({
            "total_income": row["income"] if row and row["income"] else 0
        })
    finally:
        conn.close()


@app.route("/admin/login", methods=["POST"])
@limiter.limit("5 per minute")
def admin_login():
    data = request.get_json()

    if not data:
        return jsonify({"error": "Invalid JSON"}), 400

    username = data.get("username")
    password = data.get("password")

    if not username or not password:
        return jsonify({"error": "Username and password required"}), 400

    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM admin WHERE username=%s",
            (username,)
        )
        admin = cursor.fetchone()

        if not admin:
            return jsonify({"error": "Invalid credentials"}), 401

        if not check_password_hash(admin["password"], password):
            return jsonify({"error": "Invalid credentials"}), 401

        access_token = create_access_token(identity=username)

        return jsonify({"access_token": access_token})
    finally:
        conn.close()


def delete_old_orders():
    conn = get_connection()
    try:
        conn.execute("""
            DELETE FROM orders
            WHERE status='paid'
            AND created_at < NOW() - INTERVAL '30 days'
        """)
        conn.commit()
        print("Old orders cleaned.")
    finally:
        conn.close()


scheduler = BackgroundScheduler()
scheduler.add_job(delete_old_orders, "interval", hours=24)
scheduler.start()

@app.route("/init-db")
def init_db_route():
    from init_db import initialize_database
    initialize_database()
    return "Database initialized successfully"


if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=5000)
