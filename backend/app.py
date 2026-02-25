"""
app.py — Production Flask + Socket.IO restaurant ordering backend
=================================================================
Architecture
  ├─ Blueprints:  tables_bp, orders_bp, stats_bp, admin_bp
  ├─ Services:    emit_event(), parse_items()
  ├─ Middleware:  structured logging, global error handlers
  └─ Extensions:  JWT, Cache, CORS, SocketIO (eventlet)

Performance highlights
  • db_conn() context manager — no manual commit/rollback boilerplate
  • Cache invalidation scoped to affected key groups
  • Partial index on (status, created_at) WHERE status='paid' for stats queries
  • Response-time logging via @app.before/after_request
  • Pool exhaustion surfaces a clean 503 instead of a 500 traceback

Scalability notes (500+ users)
  • Increase DB_POOL_MAX env var (default 15)
  • Switch to Redis cache (CACHE_TYPE=RedisCache + CACHE_REDIS_URL)
  • Run multiple Gunicorn workers with eventlet worker class
  • Add a Redis message queue for Socket.IO multi-process broadcasting
"""

# ── Eventlet monkey-patch MUST be first ───────────────────────────────────────
import eventlet
eventlet.monkey_patch()

# ── Standard library ──────────────────────────────────────────────────────────
import os
import csv
import io
import json
import time
import logging
import logging.config
from datetime import datetime

# ── Third-party ───────────────────────────────────────────────────────────────
from flask import Flask, Blueprint, request, jsonify, Response, g
from flask_cors import CORS
from flask_jwt_extended import JWTManager, create_access_token, jwt_required
from flask_socketio import SocketIO
from flask_caching import Cache

# ── Internal ──────────────────────────────────────────────────────────────────
from database import db_conn, init_pool
from init_db import initialize_database


# ════════════════════════════════════════════════════════════════════════════════
#                              LOGGING
# ════════════════════════════════════════════════════════════════════════════════

logging.config.dictConfig({
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "json": {
            "()": "logging.Formatter",
            "fmt": '{"time":"%(asctime)s","level":"%(levelname)s","name":"%(name)s","msg":%(message)s}',
            "datefmt": "%Y-%m-%dT%H:%M:%S",
        },
        "plain": {
            "format": "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
            "datefmt": "%Y-%m-%dT%H:%M:%S",
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "plain",
            "stream": "ext://sys.stdout",
        }
    },
    "root": {"level": os.getenv("LOG_LEVEL", "INFO"), "handlers": ["console"]},
})

logger = logging.getLogger(__name__)


# ════════════════════════════════════════════════════════════════════════════════
#                           APP & EXTENSIONS
# ════════════════════════════════════════════════════════════════════════════════

app = Flask(__name__)

FRONTEND_URL = os.getenv("FRONTEND_URL", "*")

app.config.update(
    JWT_SECRET_KEY=os.getenv("JWT_SECRET_KEY", "change-me-in-production"),
    JWT_ACCESS_TOKEN_EXPIRES=3600,
    # ── Cache: swap for RedisCache in production with many dynos ──
    CACHE_TYPE=os.getenv("CACHE_TYPE", "SimpleCache"),
    CACHE_DEFAULT_TIMEOUT=5,
    CACHE_REDIS_URL=os.getenv("REDIS_URL"),          # used only if CACHE_TYPE=RedisCache
    JSON_SORT_KEYS=False,
    PROPAGATE_EXCEPTIONS=True,
)

CORS(app, resources={r"/*": {"origins": FRONTEND_URL}}, supports_credentials=True)

jwt   = JWTManager(app)
cache = Cache(app)

socketio = SocketIO(
    app,
    cors_allowed_origins=FRONTEND_URL,
    async_mode="eventlet",
    ping_timeout=20,
    ping_interval=10,
    # For multi-worker deployments add:
    # message_queue=os.getenv("REDIS_URL"),
    logger=False,
    engineio_logger=False,
)

# Initialise DB pool and schema once at startup
init_pool()
initialize_database()


# ════════════════════════════════════════════════════════════════════════════════
#                         SHARED UTILITIES
# ════════════════════════════════════════════════════════════════════════════════

def parse_items(rows: list[dict]) -> list[dict]:
    """Decode the JSON items column in-place for a list of order rows."""
    for row in rows:
        raw = row.get("items")
        row["items"] = json.loads(raw) if raw else []
    return rows


def emit_event(event: str, data: dict) -> None:
    """Broadcast a Socket.IO event, swallowing errors so HTTP responses never fail."""
    try:
        socketio.emit(event, data, broadcast=True)
    except Exception as exc:
        logger.warning("Socket emit failed [%s]: %s", event, exc)


# ── Cache key groups — invalidate by topic, not by hand ───────────────────────
CACHE_TABLES  = ["all_tables"]
CACHE_ORDERS  = ["all_orders"]
CACHE_FINANCE = ["total_income", "stats_daily", "stats_monthly"]


def bust(*groups):
    keys = [k for g in groups for k in g]
    cache.delete_many(*keys)


# ════════════════════════════════════════════════════════════════════════════════
#                          REQUEST TIMING MIDDLEWARE
# ════════════════════════════════════════════════════════════════════════════════

@app.before_request
def _start_timer():
    g.start_time = time.perf_counter()


@app.after_request
def _log_request(response):
    elapsed_ms = (time.perf_counter() - g.get("start_time", time.perf_counter())) * 1000
    logger.info(
        '"%s %s %s" %d %.1fms',
        request.method, request.path, request.environ.get("SERVER_PROTOCOL", "HTTP/1.1"),
        response.status_code, elapsed_ms,
    )
    return response


# ════════════════════════════════════════════════════════════════════════════════
#                        GLOBAL ERROR HANDLERS
# ════════════════════════════════════════════════════════════════════════════════

@app.errorhandler(400)
def bad_request(exc):
    return jsonify(error="Bad request", detail=str(exc)), 400


@app.errorhandler(401)
def unauthorised(exc):
    return jsonify(error="Unauthorised"), 401


@app.errorhandler(404)
def not_found(exc):
    return jsonify(error="Resource not found"), 404


@app.errorhandler(RuntimeError)
def db_pool_error(exc):
    logger.error("Pool error: %s", exc)
    return jsonify(error="Service temporarily unavailable — please retry"), 503


@app.errorhandler(Exception)
def unhandled_exception(exc):
    logger.exception("Unhandled exception: %s", exc)
    return jsonify(error="Internal server error"), 500


# ════════════════════════════════════════════════════════════════════════════════
#                           BLUEPRINTS
# ════════════════════════════════════════════════════════════════════════════════

# ── Tables ────────────────────────────────────────────────────────────────────

tables_bp = Blueprint("tables", __name__, url_prefix="/tables")


@tables_bp.get("")
@cache.cached(timeout=5, key_prefix="all_tables")
def get_tables():
    with db_conn() as cur:
        cur.execute("SELECT id, number, status FROM tables ORDER BY id ASC")
        return jsonify(cur.fetchall())


@tables_bp.put("/<int:table_id>")
@jwt_required()
def update_table_status(table_id):
    data = request.get_json()
    if not data or "status" not in data:
        return jsonify(error="Status field required"), 400

    with db_conn() as cur:
        cur.execute(
            "UPDATE tables SET status=%s WHERE id=%s RETURNING id",
            (data["status"], table_id),
        )
        if not cur.fetchone():
            return jsonify(error="Table not found"), 404

    bust(CACHE_TABLES)
    emit_event("table_updated", {"table_id": table_id})
    return jsonify(message="Table status updated")


app.register_blueprint(tables_bp)

# ── Orders ────────────────────────────────────────────────────────────────────

orders_bp = Blueprint("orders", __name__, url_prefix="/orders")


@orders_bp.post("")
def create_order():
    data = request.get_json()
    if not data:
        return jsonify(error="Invalid JSON"), 400

    session_id = data.get("session_id")
    table_id   = data.get("table_id")
    if not session_id:
        return jsonify(error="session_id is required"), 400

    with db_conn() as cur:
        cur.execute(
            """
            INSERT INTO orders
                (table_id, items, total, status, customer_name, whatsapp, session_id)
            VALUES (%s, %s, %s, 'pending', %s, %s, %s)
            RETURNING id
            """,
            (
                table_id,
                json.dumps(data.get("items", [])),
                data.get("total", 0),
                data.get("customer_name"),
                data.get("whatsapp"),
                session_id,
            ),
        )
        order_id = cur.fetchone()["id"]

        if table_id:
            cur.execute(
                "UPDATE tables SET status='reserved' WHERE id=%s",
                (table_id,),
            )

    bust(CACHE_TABLES, CACHE_ORDERS, CACHE_FINANCE)
    emit_event("new_order", {"message": "New order received", "order_id": order_id})
    return jsonify(message="Order created successfully", order_id=order_id), 201


@orders_bp.get("")
@jwt_required()
@cache.cached(timeout=5, key_prefix="all_orders")
def get_orders():
    with db_conn() as cur:
        cur.execute(
            """
            SELECT id, table_id, items, total, status,
                   customer_name, whatsapp, session_id, created_at
            FROM orders
            ORDER BY created_at DESC
            """
        )
        return jsonify(parse_items(cur.fetchall()))


@orders_bp.get("/session/<session_id>")
def get_session_orders(session_id):
    with db_conn() as cur:
        cur.execute(
            """
            SELECT id, table_id, items, total, status,
                   customer_name, whatsapp, session_id, created_at
            FROM orders
            WHERE session_id = %s
            ORDER BY created_at ASC
            """,
            (session_id,),
        )
        return jsonify(parse_items(cur.fetchall()))


@orders_bp.get("/table/<int:table_id>")
def get_orders_by_table(table_id):
    session_id = request.args.get("session_id")
    if not session_id:
        return jsonify([])

    with db_conn() as cur:
        cur.execute(
            """
            SELECT id, table_id, items, total, status,
                   customer_name, whatsapp, session_id, created_at
            FROM orders
            WHERE table_id = %s AND session_id = %s
            ORDER BY id ASC
            """,
            (table_id, session_id),
        )
        return jsonify(parse_items(cur.fetchall()))


@orders_bp.put("/<int:order_id>")
@jwt_required()
def update_order_status(order_id):
    data = request.get_json()
    if not data or "status" not in data:
        return jsonify(error="Status field required"), 400

    with db_conn() as cur:
        cur.execute(
            "UPDATE orders SET status=%s WHERE id=%s RETURNING id",
            (data["status"], order_id),
        )
        if not cur.fetchone():
            return jsonify(error="Order not found"), 404

    bust(CACHE_ORDERS)
    emit_event("order_updated", {"order_id": order_id})
    return jsonify(message="Status updated")


@orders_bp.put("/<int:order_id>/pay")
@jwt_required()
def mark_paid(order_id):
    with db_conn() as cur:
        # Mark order paid and grab the table_id in one round-trip
        cur.execute(
            "UPDATE orders SET status='paid' WHERE id=%s RETURNING table_id",
            (order_id,),
        )
        row = cur.fetchone()
        if not row:
            return jsonify(error="Order not found"), 404

        table_id = row["table_id"]
        if table_id:
            cur.execute("UPDATE tables SET status='free' WHERE id=%s", (table_id,))

    bust(CACHE_TABLES, CACHE_ORDERS, CACHE_FINANCE)
    emit_event("order_updated", {"order_id": order_id})
    if table_id:
        emit_event("table_updated", {"table_id": table_id})

    return jsonify(message="Order marked paid and table freed")


app.register_blueprint(orders_bp)

# ── Income ────────────────────────────────────────────────────────────────────

income_bp = Blueprint("income", __name__, url_prefix="/income")


@income_bp.get("")
@jwt_required()
@cache.cached(timeout=30, key_prefix="total_income")
def total_income():
    with db_conn() as cur:
        cur.execute(
            "SELECT COALESCE(SUM(total), 0) AS income FROM orders WHERE status='paid'"
        )
        row = cur.fetchone()
        return jsonify(total_income=float(row["income"]))


app.register_blueprint(income_bp)

# ── Stats ─────────────────────────────────────────────────────────────────────

stats_bp = Blueprint("stats", __name__, url_prefix="/stats")


@stats_bp.get("/daily")
@jwt_required()
@cache.cached(timeout=60, key_prefix="stats_daily")
def stats_daily():
    """Daily stats for the last 30 days (uses partial index on paid orders)."""
    with db_conn() as cur:
        cur.execute(
            """
            SELECT
                DATE(created_at)                           AS date,
                COUNT(*)                                   AS total_orders,
                COALESCE(SUM(total), 0)                    AS total_income,
                COALESCE(ROUND(AVG(total)::NUMERIC, 2), 0) AS avg_order_value
            FROM orders
            WHERE status = 'paid'
              AND created_at >= CURRENT_DATE - INTERVAL '30 days'
            GROUP BY DATE(created_at)
            ORDER BY date DESC
            """
        )
        rows = cur.fetchall()

    for row in rows:
        row["date"]            = str(row["date"])
        row["total_income"]    = float(row["total_income"])
        row["avg_order_value"] = float(row["avg_order_value"])
    return jsonify(rows)


@stats_bp.get("/monthly")
@jwt_required()
@cache.cached(timeout=60, key_prefix="stats_monthly")
def stats_monthly():
    """Monthly stats for the last 12 months."""
    with db_conn() as cur:
        cur.execute(
            """
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
            """
        )
        rows = cur.fetchall()

    for row in rows:
        row["total_income"]    = float(row["total_income"])
        row["avg_order_value"] = float(row["avg_order_value"])
    return jsonify(rows)


@stats_bp.get("/monthly/csv")
@jwt_required()
def monthly_csv():
    """Download paid orders for a given month as CSV.  ?month=YYYY-MM"""
    month = request.args.get("month")

    with db_conn() as cur:
        if month:
            cur.execute(
                """
                SELECT id, table_id, customer_name, whatsapp,
                       items, total, created_at
                FROM orders
                WHERE status = 'paid'
                  AND TO_CHAR(created_at, 'YYYY-MM') = %s
                ORDER BY created_at ASC
                """,
                (month,),
            )
        else:
            cur.execute(
                """
                SELECT id, table_id, customer_name, whatsapp,
                       items, total, created_at
                FROM orders
                WHERE status = 'paid'
                  AND DATE_TRUNC('month', created_at) = DATE_TRUNC('month', CURRENT_DATE)
                ORDER BY created_at ASC
                """
            )
        rows = cur.fetchall()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Order ID", "Date", "Time", "Table",
                     "Customer", "WhatsApp", "Items", "Total (Rs.)"])

    for row in rows:
        items_data    = json.loads(row["items"]) if row.get("items") else []
        items_summary = " | ".join(
            f"{item['name']} x{item['quantity']}" for item in items_data
        )
        dt = row["created_at"]
        date_str = dt.strftime("%Y-%m-%d") if hasattr(dt, "strftime") else str(dt)[:10]
        time_str = dt.strftime("%H:%M")    if hasattr(dt, "strftime") else str(dt)[11:16]
        writer.writerow([
            row["id"], date_str, time_str,
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
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


app.register_blueprint(stats_bp)

# ── Admin ─────────────────────────────────────────────────────────────────────

admin_bp = Blueprint("admin", __name__, url_prefix="/admin")

_ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "SHUBHAM")
_ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "8830146272")


@admin_bp.post("/login")
def admin_login():
    data = request.get_json()
    if not data or not data.get("username") or not data.get("password"):
        return jsonify(message="Username and password required"), 400

    if data["username"] == _ADMIN_USERNAME and data["password"] == _ADMIN_PASSWORD:
        token = create_access_token(identity=data["username"])
        return jsonify(access_token=token), 200

    logger.warning("Failed login attempt for username=%s", data.get("username"))
    return jsonify(message="Invalid credentials"), 401


app.register_blueprint(admin_bp)


# ════════════════════════════════════════════════════════════════════════════════
#                            HEALTH CHECK
# ════════════════════════════════════════════════════════════════════════════════

@app.get("/health")
def health_check():
    """Liveness probe — also tests DB connectivity."""
    try:
        with db_conn() as cur:
            cur.execute("SELECT 1")
        return jsonify(status="ok", db="connected"), 200
    except Exception as exc:
        logger.error("Health check DB failure: %s", exc)
        return jsonify(status="degraded", db="unavailable"), 503


# ════════════════════════════════════════════════════════════════════════════════
#                         SOCKET.IO EVENTS
# ════════════════════════════════════════════════════════════════════════════════

@socketio.on("connect")
def on_connect():
    logger.debug("Socket client connected: %s", request.sid)


@socketio.on("disconnect")
def on_disconnect():
    logger.debug("Socket client disconnected: %s", request.sid)


# ════════════════════════════════════════════════════════════════════════════════
#                              ENTRY POINT
# ════════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    logger.info("Starting server on port %d", port)
    socketio.run(app, host="0.0.0.0", port=port, debug=False)
