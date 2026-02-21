# ============================================================
#                        IMPORTS
# ============================================================

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
# Protects APIs from abuse (brute force, spam, etc.)
limiter = Limiter(
    get_remote_address,
    app=app,
    default_limits=["200 per day", "50 per hour"]
)

# -------------------- CORS CONFIG --------------------
# Allows frontend (React app) to access backend
CORS(
    app,
    resources={r"/*": {"origins": "http://localhost:5173"}},
    supports_credentials=True,
)

# -------------------- JWT CONFIG --------------------
# Used for admin authentication
app.config["JWT_SECRET_KEY"] = "super-secret-key"
jwt = JWTManager(app)

# -------------------- SOCKET.IO --------------------
# Used for real-time updates
socketio = SocketIO(
    app,
    cors_allowed_origins="http://localhost:5173"
)


# ============================================================
#                        ROUTES
# ============================================================

# ============================================================
# GET ALL TABLES
# ============================================================

@app.route("/tables", methods=["GET"])
def get_tables():
    conn = get_connection()
    try:
        tables = conn.execute("SELECT * FROM tables").fetchall()
        return jsonify([dict(row) for row in tables])
    finally:
        conn.close()


# ============================================================
# CREATE NEW ORDER
# ============================================================

@app.route("/orders", methods=["POST"])
def create_order():
    conn = None
    try:
        data = request.get_json()

        # Validate JSON
        if not data:
            return jsonify({"error": "Invalid JSON"}), 400

        session_id = data.get("session_id")
        if not session_id:
            return jsonify({"error": "Session ID missing"}), 400

        conn = get_connection()
        cursor = conn.cursor()

        # Insert order
        cursor.execute("""
            INSERT INTO orders 
            (table_id, items, total, status, customer_name, whatsapp, session_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (
            data.get("table_id"),
            json.dumps(data.get("items", [])),
            data.get("total", 0),
            "pending",
            data.get("customer_name"),
            data.get("whatsapp"),
            session_id
        ))

        # Mark table as reserved
        cursor.execute("""
            UPDATE tables SET status='reserved' WHERE id=?
        """, (data.get("table_id"),))

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


# ============================================================
# GET ORDERS BY SESSION
# ============================================================

@app.route("/orders/session/<session_id>", methods=["GET"])
def get_session_orders(session_id):
    conn = get_connection()
    try:
        orders = conn.execute(
            "SELECT * FROM orders WHERE session_id=? ORDER BY created_at ASC",
            (session_id,)
        ).fetchall()

        result = []
        for row in orders:
            order = dict(row)
            order["items"] = json.loads(order["items"]) if order.get("items") else []
            result.append(order)

        return jsonify(result)
    finally:
        conn.close()


# ============================================================
# GET ALL ORDERS (ADMIN ONLY)
# ============================================================

@app.route("/orders", methods=["GET"])
@jwt_required()
def get_orders():
    conn = get_connection()
    try:
        rows = conn.execute("SELECT * FROM orders").fetchall()

        result = []
        for row in rows:
            order = dict(row)
            order["items"] = json.loads(order["items"]) if order.get("items") else []
            result.append(order)

        return jsonify(result)
    finally:
        conn.close()


# ============================================================
# GET ORDERS BY TABLE + SESSION
# ============================================================

@app.route("/orders/table/<int:table_id>", methods=["GET"])
def get_orders_by_table(table_id):
    session_id = request.args.get("session_id")

    if not session_id:
        return jsonify([])

    conn = get_connection()
    try:
        rows = conn.execute("""
            SELECT * FROM orders
            WHERE table_id=? AND session_id=?
            ORDER BY id ASC
        """, (table_id, session_id)).fetchall()

        result = []
        for row in rows:
            order = dict(row)
            order["items"] = json.loads(order["items"]) if order.get("items") else []
            result.append(order)

        return jsonify(result)
    finally:
        conn.close()


# ============================================================
# UPDATE ORDER STATUS (ADMIN)
# ============================================================

@app.route("/orders/<int:order_id>", methods=["PUT"])
@jwt_required()
def update_order_status(order_id):
    data = request.get_json()

    if not data or "status" not in data:
        return jsonify({"error": "Status required"}), 400

    conn = get_connection()
    try:
        conn.execute(
            "UPDATE orders SET status=? WHERE id=?",
            (data["status"], order_id)
        )
        conn.commit()

        # Emit socket event
        socketio.emit("order_updated", {"order_id": order_id})

        return jsonify({"message": "Status updated"})
    finally:
        conn.close()


# ============================================================
# MARK ORDER AS PAID
# ============================================================

@app.route("/orders/<int:order_id>/pay", methods=["PUT"])
@jwt_required()
def mark_paid(order_id):
    conn = get_connection()
    try:
        order = conn.execute(
            "SELECT table_id FROM orders WHERE id=?",
            (order_id,)
        ).fetchone()

        if not order:
            return jsonify({"error": "Order not found"}), 404

        table_id = order["table_id"]

        # Update order & table
        conn.execute("UPDATE orders SET status='paid' WHERE id=?", (order_id,))
        conn.execute("UPDATE tables SET status='free' WHERE id=?", (table_id,))
        conn.commit()

        # Emit socket events
        socketio.emit("order_updated", {"order_id": order_id})
        socketio.emit("table_updated", {"table_id": table_id})

        return jsonify({"message": "Order paid & table freed"})
    finally:
        conn.close()


# ============================================================
# UPDATE TABLE STATUS
# ============================================================

@app.route("/tables/<int:table_id>", methods=["PUT"])
@jwt_required()
def update_table_status(table_id):
    data = request.get_json()

    if not data or "status" not in data:
        return jsonify({"error": "Status required"}), 400

    conn = get_connection()
    try:
        conn.execute(
            "UPDATE tables SET status=? WHERE id=?",
            (data["status"], table_id)
        )
        conn.commit()

        socketio.emit("table_updated", {"table_id": table_id})

        return jsonify({"message": "Table status updated"})
    finally:
        conn.close()


# ============================================================
# TOTAL INCOME (ADMIN)
# ============================================================

@app.route("/income", methods=["GET"])
@jwt_required()
def total_income():
    conn = get_connection()
    try:
        row = conn.execute("""
            SELECT SUM(total) as income 
            FROM orders 
            WHERE status='paid'
        """).fetchone()

        return jsonify({
            "total_income": row["income"] if row and row["income"] else 0
        })
    finally:
        conn.close()


# ============================================================
# ADMIN LOGIN
# ============================================================

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
        admin = conn.execute(
            "SELECT * FROM admin WHERE username=?",
            (username,)
        ).fetchone()

        if not admin:
            return jsonify({"error": "Invalid credentials"}), 401

        if not check_password_hash(admin["password"], password):
            return jsonify({"error": "Invalid credentials"}), 401

        access_token = create_access_token(identity=username)

        return jsonify({"access_token": access_token})
    finally:
        conn.close()


# ============================================================
# AUTO CLEANUP (POSTGRESQL)
# ============================================================

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


# Run cleanup every 24 hours
scheduler = BackgroundScheduler()
scheduler.add_job(delete_old_orders, "interval", hours=24)
scheduler.start()


# ============================================================
# RUN SERVER
# ============================================================

if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=5000, debug=True)
