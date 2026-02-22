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
import csv
import io
import json
from flask import Flask, request, jsonify, Response
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
    CACHE_DEFAULT_TIMEOUT    = 5,
    JSON_SORT_KEYS           = False,
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
    logger=False,
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

        cache.delete_many("all_tables", "all_orders", "total_income",
                          "stats_daily", "stats_monthly")
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

        cache.delete_many("all_tables", "all_orders", "total_income",
                          "stats_daily", "stats_monthly")
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
        cursor.execute(
            "SELECT COALESCE(SUM(total), 0) AS income FROM orders WHERE status='paid'"
        )
        row = cursor.fetchone()
        return jsonify({"total_income": float(row["income"])})
    finally:
        release_connection(conn)


# ============================================================
#                   ROUTES — STATS
# ============================================================

@app.route("/stats/daily", methods=["GET"])
@jwt_required()
@cache.cached(timeout=60, key_prefix="stats_daily")
def stats_daily():
    """Daily stats for last 30 days: date, orders, income, avg order value."""
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT
                DATE(created_at)                               AS date,
                COUNT(*)                                       AS total_orders,
                COALESCE(SUM(total), 0)                        AS total_income,
                COALESCE(ROUND(AVG(total)::NUMERIC, 2), 0)     AS avg_order_value
            FROM orders
            WHERE status = 'paid'
              AND created_at >= CURRENT_DATE - INTERVAL '30 days'
            GROUP BY DATE(created_at)
            ORDER BY date DESC
        """)
        rows = cursor.fetchall()
        for row in rows:
            row["date"]            = str(row["date"])
            row["total_income"]    = float(row["total_income"])
            row["avg_order_value"] = float(row["avg_order_value"])
        return jsonify(rows)
    finally:
        release_connection(conn)


@app.route("/stats/monthly", methods=["GET"])
@jwt_required()
@cache.cached(timeout=60, key_prefix="stats_monthly")
def stats_monthly():
    """Monthly stats for last 12 months: month, orders, income, avg, best day."""
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT
                EXTRACT(YEAR  FROM created_at)::INT            AS year,
                EXTRACT(MONTH FROM created_at)::INT            AS month,
                TO_CHAR(created_at, 'Mon YYYY')                AS month_label,
                COUNT(*)                                       AS total_orders,
                COALESCE(SUM(total), 0)                        AS total_income,
                COALESCE(ROUND(AVG(total)::NUMERIC, 2), 0)     AS avg_order_value,
                MODE() WITHIN GROUP (
                    ORDER BY TO_CHAR(created_at, 'Day')
                )                                              AS best_day
            FROM orders
            WHERE status = 'paid'
              AND created_at >= CURRENT_DATE - INTERVAL '12 months'
            GROUP BY year, month, month_label
            ORDER BY year DESC, month DESC
        """)
        rows = cursor.fetchall()
        for row in rows:
            row["total_income"]    = float(row["total_income"])
            row["avg_order_value"] = float(row["avg_order_value"])
        return jsonify(rows)
    finally:
        release_connection(conn)


@app.route("/stats/monthly/csv", methods=["GET"])
@jwt_required()
def monthly_csv():
    """Download all paid orders for a given month as CSV. ?month=YYYY-MM"""
    month = request.args.get("month")  # e.g. "2026-02", defaults to current month

    conn = get_connection()
    try:
        cursor = conn.cursor()

        if month:
            cursor.execute("""
                SELECT id, table_id, customer_name, whatsapp,
                       items, total, created_at
                FROM orders
                WHERE status = 'paid'
                  AND TO_CHAR(created_at, 'YYYY-MM') = %s
                ORDER BY created_at ASC
            """, (month,))
        else:
            cursor.execute("""
                SELECT id, table_id, customer_name, whatsapp,
                       items, total, created_at
                FROM orders
                WHERE status = 'paid'
                  AND DATE_TRUNC('month', created_at) = DATE_TRUNC('month', CURRENT_DATE)
                ORDER BY created_at ASC
            """)

        rows = cursor.fetchall()

        output = io.StringIO()
        writer = csv.writer(output)

        writer.writerow([
            "Order ID", "Date", "Time", "Table",
            "Customer", "WhatsApp", "Items", "Total (Rs.)"
        ])

        for row in rows:
            items_data    = json.loads(row["items"]) if row.get("items") else []
            items_summary = " | ".join(
                f"{item['name']} x{item['quantity']}" for item in items_data
            )
            dt = row["created_at"]
            writer.writerow([
                row["id"],
                dt.strftime("%Y-%m-%d") if hasattr(dt, "strftime") else str(dt)[:10],
                dt.strftime("%H:%M")    if hasattr(dt, "strftime") else str(dt)[11:16],
                f"Table {row['table_id']}",
                row["customer_name"],
                row["whatsapp"],
                items_summary,
                float(row["total"]),
            ])

        output.seek(0)
        filename = f"orders_{month or 'this_month'}.csv"

        return Response(
            output.getvalue(),
            mimetype="text/csv",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
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
