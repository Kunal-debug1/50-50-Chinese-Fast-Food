"""
app.py — Production Flask + Socket.IO restaurant ordering backend
=================================================================
Architecture
  ├─ Blueprints:  tables_bp, orders_bp, stats_bp, admin_bp, income_bp
  ├─ Services:    emit_event()
  ├─ Middleware:  structured logging, global error handlers, request timing
  └─ Extensions:  JWT, Cache, CORS, SocketIO (eventlet)

MongoDB migration notes
  • All SQL queries replaced with PyMongo find/insert_one/update_one
  • ObjectId serialised to string before JSON responses
  • Dates stored as Python datetime (UTC-aware) → ISO strings in responses
  • table_id stored as plain int (matches legacy numeric FK semantics)

Performance highlights
  • Partial index on {status:"paid"} for stats queries  (see init_db.py)
  • Cache invalidation scoped to affected key groups
  • Response-time logging via @app.before/after_request
  • Connection errors surface as clean 503s

Scalability notes (500+ users)
  • Increase MONGO_POOL_MAX env var (default 50)
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
from datetime import datetime, timezone, timedelta

# ── Third-party ───────────────────────────────────────────────────────────────
from flask import Flask, Blueprint, request, jsonify, Response, g
from flask_cors import CORS
from flask_jwt_extended import JWTManager, create_access_token, jwt_required
from flask_socketio import SocketIO
from flask_caching import Cache
from bson import ObjectId
from pymongo.errors import PyMongoError

# ── Internal ──────────────────────────────────────────────────────────────────
from database import init_mongo, get_collection, ping_db
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
    CACHE_TYPE=os.getenv("CACHE_TYPE", "SimpleCache"),
    CACHE_DEFAULT_TIMEOUT=5,
    CACHE_REDIS_URL=os.getenv("REDIS_URL"),
    JSON_SORT_KEYS=False,
    PROPAGATE_EXCEPTIONS=True,
)

CORS(app, resources={r"/*": {"origins": FRONTEND_URL}}, supports_credentials=True)

jwt    = JWTManager(app)
cache  = Cache(app)

socketio = SocketIO(
    app,
    cors_allowed_origins=FRONTEND_URL,
    async_mode="eventlet",
    ping_timeout=20,
    ping_interval=10,
    logger=False,
    engineio_logger=False,
)

# Initialise MongoDB client and seed data once at startup
init_mongo()
initialize_database()


# ════════════════════════════════════════════════════════════════════════════════
#                         SHARED UTILITIES
# ════════════════════════════════════════════════════════════════════════════════

def _serialize(doc: dict) -> dict:
    """
    Convert a MongoDB document to a JSON-serialisable dict.
    - ObjectId  → str
    - datetime  → ISO-8601 string (UTC)
    """
    if doc is None:
        return {}
    out = {}
    for k, v in doc.items():
        if isinstance(v, ObjectId):
            out[k] = str(v)
        elif isinstance(v, datetime):
            out[k] = v.isoformat()
        else:
            out[k] = v
    return out


def _serialize_list(docs) -> list[dict]:
    return [_serialize(d) for d in docs]


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


@app.errorhandler(PyMongoError)
def mongo_error(exc):
    logger.error("MongoDB error: %s", exc)
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
    docs = get_collection("tables").find({}, {"_id": 1, "number": 1, "status": 1})
    result = []
    for doc in docs:
        result.append({
            "id":     str(doc["_id"]),
            "number": doc["number"],
            "status": doc["status"],
        })
    return jsonify(result)


@tables_bp.put("/<table_id>")
@jwt_required()
def update_table_status(table_id):
    data = request.get_json()
    if not data or "status" not in data:
        return jsonify(error="Status field required"), 400

    col = get_collection("tables")

    # Support both ObjectId _id and legacy numeric id stored in a field
    filter_q = _build_table_filter(table_id)
    result = col.update_one(filter_q, {"$set": {"status": data["status"]}})
    if result.matched_count == 0:
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

    orders_col = get_collection("orders")
    tables_col = get_collection("tables")

    doc = {
        "table_id":      table_id,
        "items":         data.get("items", []),   # stored as native array — no JSON string needed
        "total":         float(data.get("total", 0)),
        "status":        "pending",
        "customer_name": data.get("customer_name"),
        "whatsapp":      data.get("whatsapp"),
        "session_id":    session_id,
        "created_at":    datetime.now(timezone.utc),
    }
    inserted = orders_col.insert_one(doc)
    order_id = str(inserted.inserted_id)

    if table_id:
        tables_col.update_one(
            _build_table_filter(table_id),
            {"$set": {"status": "reserved"}},
        )

    bust(CACHE_TABLES, CACHE_ORDERS, CACHE_FINANCE)
    emit_event("new_order", {"message": "New order received", "order_id": order_id})
    return jsonify(message="Order created successfully", order_id=order_id), 201


@orders_bp.get("")
@jwt_required()
@cache.cached(timeout=5, key_prefix="all_orders")
def get_orders():
    docs = get_collection("orders").find({}).sort("created_at", -1)
    return jsonify(_serialize_list(docs))


@orders_bp.get("/session/<session_id>")
def get_session_orders(session_id):
    docs = get_collection("orders").find(
        {"session_id": session_id}
    ).sort("created_at", 1)
    return jsonify(_serialize_list(docs))


@orders_bp.get("/table/<table_id>")
def get_orders_by_table(table_id):
    session_id = request.args.get("session_id")
    if not session_id:
        return jsonify([])

    docs = get_collection("orders").find(
        {"table_id": _coerce_table_id(table_id), "session_id": session_id}
    ).sort("_id", 1)
    return jsonify(_serialize_list(docs))


@orders_bp.put("/<order_id>")
@jwt_required()
def update_order_status(order_id):
    data = request.get_json()
    if not data or "status" not in data:
        return jsonify(error="Status field required"), 400

    result = get_collection("orders").update_one(
        {"_id": ObjectId(order_id)},
        {"$set": {"status": data["status"]}},
    )
    if result.matched_count == 0:
        return jsonify(error="Order not found"), 404

    bust(CACHE_ORDERS)
    emit_event("order_updated", {"order_id": order_id})
    return jsonify(message="Status updated")


@orders_bp.put("/<order_id>/pay")
@jwt_required()
def mark_paid(order_id):
    orders_col = get_collection("orders")
    tables_col = get_collection("tables")

    order = orders_col.find_one({"_id": ObjectId(order_id)})
    if not order:
        return jsonify(error="Order not found"), 404

    orders_col.update_one(
        {"_id": ObjectId(order_id)},
        {"$set": {"status": "paid"}},
    )

    table_id = order.get("table_id")
    if table_id:
        tables_col.update_one(
            _build_table_filter(table_id),
            {"$set": {"status": "free"}},
        )

    bust(CACHE_TABLES, CACHE_ORDERS, CACHE_FINANCE)
    emit_event("order_updated", {"order_id": order_id})
    if table_id:
        emit_event("table_updated", {"table_id": str(table_id)})

    return jsonify(message="Order marked paid and table freed")


app.register_blueprint(orders_bp)


# ── Income ────────────────────────────────────────────────────────────────────

income_bp = Blueprint("income", __name__, url_prefix="/income")


@income_bp.get("")
@jwt_required()
@cache.cached(timeout=30, key_prefix="total_income")
def total_income():
    pipeline = [
        {"$match": {"status": "paid"}},
        {"$group": {"_id": None, "income": {"$sum": "$total"}}},
    ]
    result = list(get_collection("orders").aggregate(pipeline))
    total  = result[0]["income"] if result else 0.0
    return jsonify(total_income=float(total))


app.register_blueprint(income_bp)


# ── Stats ─────────────────────────────────────────────────────────────────────

stats_bp = Blueprint("stats", __name__, url_prefix="/stats")


@stats_bp.get("/daily")
@jwt_required()
@cache.cached(timeout=60, key_prefix="stats_daily")
def stats_daily():
    """Daily stats for the last 30 days — paid orders only."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    pipeline = [
        {"$match": {"status": "paid", "created_at": {"$gte": cutoff}}},
        {"$group": {
            "_id": {
                "year":  {"$year":  "$created_at"},
                "month": {"$month": "$created_at"},
                "day":   {"$dayOfMonth": "$created_at"},
            },
            "total_orders":    {"$sum": 1},
            "total_income":    {"$sum": "$total"},
            "avg_order_value": {"$avg": "$total"},
        }},
        {"$sort": {"_id": -1}},
    ]
    rows = []
    for doc in get_collection("orders").aggregate(pipeline):
        d = doc["_id"]
        rows.append({
            "date":            f"{d['year']:04d}-{d['month']:02d}-{d['day']:02d}",
            "total_orders":    doc["total_orders"],
            "total_income":    round(float(doc["total_income"]),    2),
            "avg_order_value": round(float(doc["avg_order_value"]), 2),
        })
    return jsonify(rows)


@stats_bp.get("/monthly")
@jwt_required()
@cache.cached(timeout=60, key_prefix="stats_monthly")
def stats_monthly():
    """Monthly stats for the last 12 months."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=365)
    pipeline = [
        {"$match": {"status": "paid", "created_at": {"$gte": cutoff}}},
        {"$group": {
            "_id": {
                "year":  {"$year":  "$created_at"},
                "month": {"$month": "$created_at"},
            },
            "total_orders":    {"$sum": 1},
            "total_income":    {"$sum": "$total"},
            "avg_order_value": {"$avg": "$total"},
        }},
        {"$sort": {"_id": -1}},
    ]
    month_names = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
                   "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    rows = []
    for doc in get_collection("orders").aggregate(pipeline):
        d = doc["_id"]
        rows.append({
            "year":            d["year"],
            "month":           d["month"],
            "month_label":     f"{month_names[d['month']]} {d['year']}",
            "total_orders":    doc["total_orders"],
            "total_income":    round(float(doc["total_income"]),    2),
            "avg_order_value": round(float(doc["avg_order_value"]), 2),
        })
    return jsonify(rows)


@stats_bp.get("/monthly/csv")
@jwt_required()
def monthly_csv():
    """Download paid orders for a given month as CSV.  ?month=YYYY-MM"""
    month_param = request.args.get("month")  # e.g. "2024-03"

    query: dict = {"status": "paid"}
    if month_param:
        try:
            year, mon = map(int, month_param.split("-"))
            start = datetime(year, mon, 1, tzinfo=timezone.utc)
            # First day of the next month
            if mon == 12:
                end = datetime(year + 1, 1, 1, tzinfo=timezone.utc)
            else:
                end = datetime(year, mon + 1, 1, tzinfo=timezone.utc)
            query["created_at"] = {"$gte": start, "$lt": end}
        except (ValueError, AttributeError):
            return jsonify(error="Invalid month format — use YYYY-MM"), 400
    else:
        now   = datetime.now(timezone.utc)
        start = datetime(now.year, now.month, 1, tzinfo=timezone.utc)
        query["created_at"] = {"$gte": start}

    docs = get_collection("orders").find(query).sort("created_at", 1)

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Order ID", "Date", "Time", "Table",
                     "Customer", "WhatsApp", "Items", "Total (Rs.)"])

    for doc in docs:
        items_data    = doc.get("items", [])
        # Items are stored as native BSON arrays now — no JSON decode needed
        if isinstance(items_data, str):
            try:
                items_data = json.loads(items_data)
            except Exception:
                items_data = []
        items_summary = " | ".join(
            f"{item.get('name','?')} x{item.get('quantity','?')}"
            for item in items_data
        )
        dt       = doc.get("created_at")
        if isinstance(dt, datetime):
            date_str = dt.strftime("%Y-%m-%d")
            time_str = dt.strftime("%H:%M")
        else:
            dt_str   = str(dt)
            date_str = dt_str[:10]
            time_str = dt_str[11:16]

        writer.writerow([
            str(doc["_id"]),
            date_str,
            time_str,
            f"Table {doc.get('table_id', '-')}",
            doc.get("customer_name"),
            doc.get("whatsapp"),
            items_summary,
            doc.get("total", 0),
        ])

    output.seek(0)
    filename = f"orders_{month_param or 'this_month'}.csv"
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
    """Liveness probe — also tests MongoDB connectivity."""
    if ping_db():
        return jsonify(status="ok", db="connected"), 200
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
#                       INTERNAL HELPER FUNCTIONS
# ════════════════════════════════════════════════════════════════════════════════

def _coerce_table_id(value):
    """Try to keep table_id as int when possible (legacy compatibility)."""
    try:
        return int(value)
    except (ValueError, TypeError):
        return value


def _build_table_filter(table_id) -> dict:
    """
    Build a MongoDB filter that works whether table_id is an ObjectId string
    or a legacy integer stored in a 'table_number' / '_id' field.
    The seeded tables use ObjectId _id values; orders store table_id as int.
    This helper resolves tables by their ObjectId _id.
    """
    try:
        return {"_id": ObjectId(str(table_id))}
    except Exception:
        # Fallback: match by numeric id field or number field
        coerced = _coerce_table_id(table_id)
        return {"$or": [{"id": coerced}, {"number": str(table_id)}]}


# ════════════════════════════════════════════════════════════════════════════════
#                              ENTRY POINT
# ════════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    logger.info("Starting server on port %d", port)
    socketio.run(app, host="0.0.0.0", port=port, debug=False)
