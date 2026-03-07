"""
app.py — Production Flask + Socket.IO restaurant ordering backend
=================================================================
Architecture
  ├─ Blueprints:  tables_bp, orders_bp, income_bp, stats_bp, admin_bp
  ├─ Services:    emit_event(), _serialize(), _serialize_list()
  ├─ Middleware:  structured logging, global error handlers, request timing
  └─ Extensions:  JWT, Cache, CORS, SocketIO (eventlet)

MongoDB notes
  • ObjectId serialised → str before every JSON response
  • datetime stored UTC-aware → ISO-8601 string in responses
  • Items stored as native BSON arrays — no JSON string encode/decode
  • Projection on every find() — only fetch fields the route actually needs
  • count_documents({}, limit=1) used instead of full collection scans

Performance
  • Module-level MongoClient singleton — connection pool reused every request
  • Partial index on {status:"paid"} used by /stats aggregations (init_db.py)
  • Cache timeouts tuned: tables 30 s, orders 10 s, stats 300 s
  • Background keep-alive ping every 10 min — prevents Render cold starts
  • --preload compatible (init_mongo runs before fork)

Scalability (500+ users)
  • Set MONGO_POOL_MAX env var (default 50)
  • Switch CACHE_TYPE=RedisCache + CACHE_REDIS_URL for multi-worker caching
  • Run multiple Gunicorn eventlet workers only with Redis Socket.IO message queue
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
import requests as http_requests
from apscheduler.schedulers.background import BackgroundScheduler
from flask import Flask, Blueprint, request, jsonify, Response, g
from flask_cors import CORS
from flask_jwt_extended import (
    JWTManager, create_access_token, jwt_required, get_jwt_identity
)
from flask_socketio import SocketIO
from flask_caching import Cache
from bson import ObjectId
from bson.errors import InvalidId
from pymongo.errors import PyMongoError, DuplicateKeyError

# ── Internal ──────────────────────────────────────────────────────────────────
from database import init_mongo, get_collection, ping_db, close_mongo
from init_db import initialize_database


# ════════════════════════════════════════════════════════════════════════════════
#                              LOGGING
# ════════════════════════════════════════════════════════════════════════════════

logging.config.dictConfig({
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "plain": {
            "format":  "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
            "datefmt": "%Y-%m-%dT%H:%M:%S",
        },
    },
    "handlers": {
        "console": {
            "class":     "logging.StreamHandler",
            "formatter": "plain",
            "stream":    "ext://sys.stdout",
        }
    },
    "root": {"level": os.getenv("LOG_LEVEL", "INFO"), "handlers": ["console"]},
})

logger = logging.getLogger(__name__)


# ════════════════════════════════════════════════════════════════════════════════
#                           APP & EXTENSIONS
# ════════════════════════════════════════════════════════════════════════════════

app = Flask(__name__)

FRONTEND_URL  = os.getenv("FRONTEND_URL", "*")
SELF_URL      = os.getenv("RENDER_EXTERNAL_URL", "")  # Render sets this automatically

app.config.update(
    JWT_SECRET_KEY          = os.getenv("JWT_SECRET_KEY", "change-me-in-production"),
    JWT_ACCESS_TOKEN_EXPIRES= 3600,
    # ── Cache ─────────────────────────────────────────────────────────────────
    # Single worker → SimpleCache is fine.
    # Multi-worker  → set CACHE_TYPE=RedisCache and CACHE_REDIS_URL in Render env.
    CACHE_TYPE              = os.getenv("CACHE_TYPE", "SimpleCache"),
    CACHE_DEFAULT_TIMEOUT   = 30,
    CACHE_REDIS_URL         = os.getenv("REDIS_URL"),
    # ── Misc ──────────────────────────────────────────────────────────────────
    JSON_SORT_KEYS          = False,
    PROPAGATE_EXCEPTIONS    = True,
)

CORS(app)

jwt      = JWTManager(app)
cache    = Cache(app)

socketio = SocketIO(
    app,
    cors_allowed_origins = FRONTEND_URL,
    async_mode           = "eventlet",
    ping_timeout         = 20,
    ping_interval        = 10,
    # For multi-worker deployments uncomment:
    # message_queue=os.getenv("REDIS_URL"),
    logger               = False,
    engineio_logger      = False,
)

# ── Startup: initialise DB connection pool and seed data ──────────────────────
init_mongo()
initialize_database()


# ════════════════════════════════════════════════════════════════════════════════
#                       KEEP-ALIVE SCHEDULER
#  Pings /health every 10 min so Render free-tier never cold-starts
# ════════════════════════════════════════════════════════════════════════════════

def _keep_alive() -> None:
    if not SELF_URL:
        return
    try:
        http_requests.get(f"{SELF_URL}/health", timeout=8)
        logger.debug("Keep-alive ping sent to %s/health", SELF_URL)
    except Exception as exc:
        logger.warning("Keep-alive ping failed: %s", exc)


_scheduler = BackgroundScheduler(daemon=True)
_scheduler.add_job(_keep_alive, "interval", minutes=10, id="keep_alive")
_scheduler.start()
logger.info("Keep-alive scheduler started (interval=10 min)")


# ════════════════════════════════════════════════════════════════════════════════
#                         SHARED UTILITIES
# ════════════════════════════════════════════════════════════════════════════════

def _serialize(doc: dict | None) -> dict:
    """
    Convert a single MongoDB document to a JSON-serialisable dict.
      ObjectId  → str
      datetime  → ISO-8601 string (UTC)
    Returns {} for None input (safe for callers that don't check).
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


def _serialize_list(cursor) -> list[dict]:
    """Serialise every document in a cursor/iterable."""
    return [_serialize(doc) for doc in cursor]


def _to_object_id(value: str) -> ObjectId | None:
    """
    Safely convert a string to ObjectId.
    Returns None if the string is not a valid 24-hex ObjectId,
    so routes can return 404 instead of crashing with InvalidId.
    """
    try:
        return ObjectId(value)
    except (InvalidId, TypeError):
        return None


def emit_event(event: str, data: dict) -> None:
    """
    Broadcast a Socket.IO event to all connected clients.
    Errors are swallowed so a broken WS channel never fails an HTTP response.
    """
    try:
        socketio.emit(event, data, broadcast=True)
    except Exception as exc:
        logger.warning("Socket emit failed [%s]: %s", event, exc)


# ── Cache key groups — bust related keys together, never by hand ──────────────
_CACHE_TABLES  = ["all_tables"]
_CACHE_ORDERS  = ["all_orders"]
_CACHE_FINANCE = ["total_income", "stats_daily", "stats_monthly"]


def _bust(*groups: list[str]) -> None:
    keys = [k for g in groups for k in g]
    cache.delete_many(*keys)


# ── Table-ID helpers ──────────────────────────────────────────────────────────

def _coerce_table_id(value):
    """Prefer int for table_id so it matches how orders store it."""
    try:
        return int(value)
    except (ValueError, TypeError):
        return value


def _build_table_filter(table_id) -> dict:
    """
    Resolve a table by ObjectId _id (seeded documents) or by integer id /
    number string (legacy fallback).
    """
    oid = _to_object_id(str(table_id))
    if oid:
        return {"_id": oid}
    coerced = _coerce_table_id(table_id)
    return {"$or": [{"id": coerced}, {"number": str(table_id)}]}


# ════════════════════════════════════════════════════════════════════════════════
#                          REQUEST TIMING MIDDLEWARE
# ════════════════════════════════════════════════════════════════════════════════

@app.before_request
def _start_timer() -> None:
    g.start_time = time.perf_counter()


@app.after_request
def _log_request(response):
    elapsed_ms = (time.perf_counter() - g.get("start_time", time.perf_counter())) * 1000
    logger.info(
        '"%s %s" %d %.1fms',
        request.method, request.path,
        response.status_code, elapsed_ms,
    )
    return response


# ════════════════════════════════════════════════════════════════════════════════
#                        GLOBAL ERROR HANDLERS
# ════════════════════════════════════════════════════════════════════════════════

@app.errorhandler(400)
def err_bad_request(exc):
    return jsonify(error="Bad request", detail=str(exc)), 400


@app.errorhandler(401)
def err_unauthorised(exc):
    return jsonify(error="Unauthorised"), 401


@app.errorhandler(403)
def err_forbidden(exc):
    return jsonify(error="Forbidden"), 403


@app.errorhandler(404)
def err_not_found(exc):
    return jsonify(error="Resource not found"), 404


@app.errorhandler(405)
def err_method_not_allowed(exc):
    return jsonify(error="Method not allowed"), 405


@app.errorhandler(422)
def err_unprocessable(exc):
    return jsonify(error="Unprocessable entity", detail=str(exc)), 422


@app.errorhandler(429)
def err_rate_limited(exc):
    return jsonify(error="Too many requests — please slow down"), 429


@app.errorhandler(DuplicateKeyError)
def err_duplicate_key(exc):
    logger.warning("MongoDB duplicate key: %s", exc)
    return jsonify(error="A record with that value already exists"), 409


@app.errorhandler(PyMongoError)
def err_mongo(exc):
    logger.error("MongoDB error: %s", exc)
    return jsonify(error="Database error — please retry"), 503


@app.errorhandler(ConnectionError)
def err_connection(exc):
    logger.error("Connection error: %s", exc)
    return jsonify(error="Service temporarily unavailable — please retry"), 503


@app.errorhandler(Exception)
def err_unhandled(exc):
    logger.exception("Unhandled exception: %s", exc)
    return jsonify(error="Internal server error"), 500


# JWT-specific error handlers ──────────────────────────────────────────────────

@jwt.expired_token_loader
def expired_token_callback(jwt_header, jwt_payload):
    return jsonify(error="Token has expired — please log in again"), 401


@jwt.invalid_token_loader
def invalid_token_callback(reason):
    return jsonify(error=f"Invalid token: {reason}"), 422


@jwt.unauthorized_loader
def missing_token_callback(reason):
    return jsonify(error="Authentication token required"), 401


# ════════════════════════════════════════════════════════════════════════════════
#                           BLUEPRINTS
# ════════════════════════════════════════════════════════════════════════════════

# ── Tables ────────────────────────────────────────────────────────────────────

tables_bp = Blueprint("tables", __name__, url_prefix="/tables")


@tables_bp.get("")
@cache.cached(timeout=30, key_prefix="all_tables")   # tables change rarely
def get_tables():
    # Projection: only fetch the three fields the response needs
    docs   = get_collection("tables").find({}, {"_id": 1, "number": 1, "status": 1})
    result = [
        {"id": str(d["_id"]), "number": d["number"], "status": d["status"]}
        for d in docs
    ]
    return jsonify(result)


@tables_bp.put("/<table_id>")
@jwt_required()
def update_table_status(table_id):
    data = request.get_json(silent=True)
    if not data or "status" not in data:
        return jsonify(error="Status field required"), 400

    allowed_statuses = {"free", "reserved", "occupied"}
    if data["status"] not in allowed_statuses:
        return jsonify(error=f"Status must be one of: {', '.join(allowed_statuses)}"), 400

    result = get_collection("tables").update_one(
        _build_table_filter(table_id),
        {"$set": {"status": data["status"]}},
    )
    if result.matched_count == 0:
        return jsonify(error="Table not found"), 404

    _bust(_CACHE_TABLES)
    emit_event("table_updated", {"table_id": table_id})
    return jsonify(message="Table status updated")


app.register_blueprint(tables_bp)


# ── Orders ────────────────────────────────────────────────────────────────────

orders_bp = Blueprint("orders", __name__, url_prefix="/orders")

# Fields projected for list-style order responses
_ORDER_PROJECTION = {
    "_id": 1, "table_id": 1, "items": 1, "total": 1,
    "status": 1, "customer_name": 1, "whatsapp": 1,
    "session_id": 1, "created_at": 1,
}


@orders_bp.post("")
def create_order():
    data = request.get_json(silent=True)
    if not data:
        return jsonify(error="Invalid or missing JSON body"), 400

    session_id = data.get("session_id")
    table_id   = data.get("table_id")

    if not session_id:
        return jsonify(error="session_id is required"), 400

    # Validate items list
    items = data.get("items", [])
    if not isinstance(items, list):
        return jsonify(error="items must be an array"), 400

    # Validate total
    try:
        total = float(data.get("total", 0))
    except (TypeError, ValueError):
        return jsonify(error="total must be a number"), 400

    orders_col = get_collection("orders")
    tables_col = get_collection("tables")

    doc = {
        "table_id":      _coerce_table_id(table_id) if table_id else None,
        "items":         items,         # native BSON array — no JSON string needed
        "total":         total,
        "status":        "pending",
        "customer_name": data.get("customer_name"),
        "whatsapp":      data.get("whatsapp"),
        "session_id":    session_id,
        "created_at":    datetime.now(timezone.utc),
    }

    inserted = orders_col.insert_one(doc)
    order_id = str(inserted.inserted_id)

    # Update table status in the same logical operation
    if table_id:
        tables_col.update_one(
            _build_table_filter(table_id),
            {"$set": {"status": "reserved"}},
        )

    _bust(_CACHE_TABLES, _CACHE_ORDERS, _CACHE_FINANCE)
    emit_event("new_order", {"message": "New order received", "order_id": order_id})
    return jsonify(message="Order created successfully", order_id=order_id), 201


@orders_bp.get("")
@jwt_required()
@cache.cached(timeout=10, key_prefix="all_orders")   # admin dashboard — fresher data
def get_orders():
    docs = get_collection("orders").find(
        {}, _ORDER_PROJECTION
    ).sort("created_at", -1)
    return jsonify(_serialize_list(docs))


@orders_bp.get("/session/<session_id>")
def get_session_orders(session_id):
    if not session_id:
        return jsonify([])
    docs = get_collection("orders").find(
        {"session_id": session_id}, _ORDER_PROJECTION
    ).sort("created_at", 1)
    return jsonify(_serialize_list(docs))


@orders_bp.get("/table/<table_id>")
def get_orders_by_table(table_id):
    session_id = request.args.get("session_id")
    if not session_id:
        return jsonify([])
    docs = get_collection("orders").find(
        {"table_id": _coerce_table_id(table_id), "session_id": session_id},
        _ORDER_PROJECTION,
    ).sort("_id", 1)
    return jsonify(_serialize_list(docs))


@orders_bp.put("/<order_id>")
@jwt_required()
def update_order_status(order_id):
    data = request.get_json(silent=True)
    if not data or "status" not in data:
        return jsonify(error="Status field required"), 400

    oid = _to_object_id(order_id)
    if not oid:
        return jsonify(error="Invalid order ID"), 400

    allowed_statuses = {"pending", "preparing", "ready", "paid", "cancelled"}
    if data["status"] not in allowed_statuses:
        return jsonify(error=f"Status must be one of: {', '.join(allowed_statuses)}"), 400

    result = get_collection("orders").update_one(
        {"_id": oid},
        {"$set": {"status": data["status"]}},
    )
    if result.matched_count == 0:
        return jsonify(error="Order not found"), 404

    _bust(_CACHE_ORDERS)
    emit_event("order_updated", {"order_id": order_id})
    return jsonify(message="Status updated")


@orders_bp.put("/<order_id>/pay")
@jwt_required()
def mark_paid(order_id):
    oid = _to_object_id(order_id)
    if not oid:
        return jsonify(error="Invalid order ID"), 400

    orders_col = get_collection("orders")
    tables_col = get_collection("tables")

    # Fetch only the field we need — avoid pulling items/etc
    order = orders_col.find_one({"_id": oid}, {"table_id": 1})
    if not order:
        return jsonify(error="Order not found"), 404

    orders_col.update_one({"_id": oid}, {"$set": {"status": "paid"}})

    table_id = order.get("table_id")
    if table_id:
        tables_col.update_one(
            _build_table_filter(table_id),
            {"$set": {"status": "free"}},
        )

    _bust(_CACHE_TABLES, _CACHE_ORDERS, _CACHE_FINANCE)
    emit_event("order_updated", {"order_id": order_id})
    if table_id:
        emit_event("table_updated", {"table_id": str(table_id)})

    return jsonify(message="Order marked paid and table freed")


app.register_blueprint(orders_bp)


# ── Income ────────────────────────────────────────────────────────────────────

income_bp = Blueprint("income", __name__, url_prefix="/income")


@income_bp.get("")
@jwt_required()
@cache.cached(timeout=60, key_prefix="total_income")
def total_income():
    pipeline = [
        {"$match": {"status": "paid"}},
        {"$group": {"_id": None, "income": {"$sum": "$total"}}},
    ]
    result = list(get_collection("orders").aggregate(pipeline))
    total  = float(result[0]["income"]) if result else 0.0
    return jsonify(total_income=total)


app.register_blueprint(income_bp)


# ── Stats ─────────────────────────────────────────────────────────────────────

stats_bp = Blueprint("stats", __name__, url_prefix="/stats")

_MONTH_NAMES = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


@stats_bp.get("/daily")
@jwt_required()
@cache.cached(timeout=300, key_prefix="stats_daily")   # stats are slow — cache 5 min
def stats_daily():
    """Daily revenue stats for the last 30 days — uses partial paid index."""
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
@cache.cached(timeout=300, key_prefix="stats_monthly")
def stats_monthly():
    """Monthly revenue stats for the last 12 months — uses partial paid index."""
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
    rows = []
    for doc in get_collection("orders").aggregate(pipeline):
        d = doc["_id"]
        rows.append({
            "year":            d["year"],
            "month":           d["month"],
            "month_label":     f"{_MONTH_NAMES[d['month']]} {d['year']}",
            "total_orders":    doc["total_orders"],
            "total_income":    round(float(doc["total_income"]),    2),
            "avg_order_value": round(float(doc["avg_order_value"]), 2),
        })
    return jsonify(rows)


@stats_bp.get("/monthly/csv")
@jwt_required()
def monthly_csv():
    """Download paid orders for a given month as CSV.  ?month=YYYY-MM"""
    month_param = request.args.get("month")

    query: dict = {"status": "paid"}

    if month_param:
        try:
            year, mon = map(int, month_param.split("-"))
            if not (1 <= mon <= 12):
                raise ValueError("month out of range")
            start = datetime(year, mon, 1, tzinfo=timezone.utc)
            end   = datetime(year + (mon == 12), (mon % 12) + 1, 1, tzinfo=timezone.utc)
            query["created_at"] = {"$gte": start, "$lt": end}
        except (ValueError, AttributeError):
            return jsonify(error="Invalid month format — use YYYY-MM"), 400
    else:
        now   = datetime.now(timezone.utc)
        start = datetime(now.year, now.month, 1, tzinfo=timezone.utc)
        query["created_at"] = {"$gte": start}

    # Projection: only fields the CSV rows need
    projection = {
        "_id": 1, "table_id": 1, "customer_name": 1,
        "whatsapp": 1, "items": 1, "total": 1, "created_at": 1,
    }
    docs = get_collection("orders").find(query, projection).sort("created_at", 1)

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Order ID", "Date", "Time", "Table",
        "Customer", "WhatsApp", "Items", "Total (Rs.)",
    ])

    for doc in docs:
        items_data = doc.get("items", [])
        # Guard against legacy docs where items was stored as a JSON string
        if isinstance(items_data, str):
            try:
                items_data = json.loads(items_data)
            except Exception:
                items_data = []

        items_summary = " | ".join(
            f"{item.get('name', '?')} x{item.get('quantity', '?')}"
            for item in items_data
            if isinstance(item, dict)
        )

        dt = doc.get("created_at")
        if isinstance(dt, datetime):
            date_str = dt.strftime("%Y-%m-%d")
            time_str = dt.strftime("%H:%M")
        else:
            s        = str(dt)
            date_str = s[:10]
            time_str = s[11:16]

        writer.writerow([
            str(doc["_id"]),
            date_str,
            time_str,
            f"Table {doc.get('table_id', '-')}",
            doc.get("customer_name", ""),
            doc.get("whatsapp", ""),
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
    data = request.get_json(silent=True)
    if not data:
        return jsonify(message="JSON body required"), 400
    if not data.get("username") or not data.get("password"):
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
    """
    Liveness + readiness probe.
    Returns 200 only when MongoDB is reachable.
    Used by Render health checks and the keep-alive scheduler.
    """
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
#                       GRACEFUL SHUTDOWN
# ════════════════════════════════════════════════════════════════════════════════

@app.teardown_appcontext
def _shutdown(exc=None):
    """Called once per app context — nothing to clean up per-request for MongoDB."""
    pass  # MongoClient pool is module-level; close_mongo() handles process shutdown


import atexit
atexit.register(close_mongo)        # clean pool on gunicorn worker exit
atexit.register(_scheduler.shutdown, wait=False)


# ════════════════════════════════════════════════════════════════════════════════
#                              ENTRY POINT
# ════════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    logger.info("Starting server on port %d", port)
    socketio.run(app, host="0.0.0.0", port=port, debug=False)
