"""
app.py — High-performance Flask + Socket.IO restaurant backend
==============================================================
Optimised for 500+ concurrent users on Render + MongoDB Atlas free tier.

Performance architecture
  ────────────────────────────────────────────────────────────────────────
  CACHING (SimpleCache → swap for RedisCache on multi-worker)
  • Tables list         — 60 s  (changes only when staff update a table)
  • All orders (admin)  — 10 s  (fresh enough for kitchen dashboard)
  • Session orders      — 10 s  (per-user, keyed by session_id)
  • Total income        — 120 s (finance card, not real-time)
  • Daily stats         — 300 s (chart data, 5-min staleness acceptable)
  • Monthly stats       — 300 s (chart data)

  MONGODB QUERY OPTIMISATIONS
  • Every find() carries an explicit projection — only fetches fields the
    route actually returns; halves document transfer on wide collections
  • Partial indexes on {status:"paid"} used by all stats aggregations
  • Aggregation pipelines use $match as the first stage so MongoDB can
    use the partial index before doing any $group work
  • count_documents({}, limit=1) instead of full collection count
  • find_one() with projection instead of find().limit(1)

  RENDER FREE-TIER COLD START PREVENTION
  • APScheduler keep-alive pings /health every 10 min
  • RENDER_EXTERNAL_URL env var used automatically (Render sets it)
  • --preload flag in start command warms the pool before workers fork

  RESPONSE OPTIMISATIONS
  • flask-compress gzip/br compression on all JSON responses
  • JSON_SORT_KEYS=False — skips alphabetical sort on every response
  • After-request logging avoids string formatting until log level check

  CONCURRENCY
  • eventlet monkey-patched — all I/O is non-blocking
  • Single Gunicorn eventlet worker handles hundreds of concurrent
    connections via cooperative multitasking (no thread-per-request)
  • Pool waitQueueTimeoutMS=5 000 → 503 after 5 s instead of infinite queue

  BLUEPRINTS
  • tables_bp   /tables
  • orders_bp   /orders
  • income_bp   /income
  • stats_bp    /stats
  • admin_bp    /admin
"""

# ── Eventlet monkey-patch — MUST be the very first import ─────────────────────
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
from flask_compress import Compress
from flask_cors import CORS
from flask_jwt_extended import (
    JWTManager, create_access_token, jwt_required,
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

FRONTEND_URL = os.getenv("FRONTEND_URL", "*")
SELF_URL     = os.getenv("RENDER_EXTERNAL_URL", "").rstrip("/")

app.config.update(
    # ── JWT ───────────────────────────────────────────────────────────────────
    JWT_SECRET_KEY           = os.getenv("JWT_SECRET_KEY", "change-me-in-production"),
    JWT_ACCESS_TOKEN_EXPIRES = 3600,

    # ── Cache ─────────────────────────────────────────────────────────────────
    # Single Gunicorn worker  → SimpleCache (in-process, zero latency)
    # Multiple workers        → set CACHE_TYPE=RedisCache + CACHE_REDIS_URL
    CACHE_TYPE               = os.getenv("CACHE_TYPE", "SimpleCache"),
    CACHE_DEFAULT_TIMEOUT    = 60,
    CACHE_REDIS_URL          = os.getenv("REDIS_URL"),

    # ── Flask ─────────────────────────────────────────────────────────────────
    JSON_SORT_KEYS           = False,
    PROPAGATE_EXCEPTIONS     = True,

    # ── Compression ───────────────────────────────────────────────────────────
    COMPRESS_MIMETYPES       = ["application/json", "text/csv", "text/plain"],
    COMPRESS_LEVEL           = 4,       # balanced speed vs ratio (1-9)
    COMPRESS_MIN_SIZE        = 500,     # don't compress tiny responses
)

# ── Extension init ────────────────────────────────────────────────────────────
Compress(app)

CORS(app)

jwt   = JWTManager(app)
cache = Cache(app)

socketio = SocketIO(
    app,
    cors_allowed_origins = FRONTEND_URL,
    async_mode           = "eventlet",
    ping_timeout         = 20,
    # FIX 2: removed stray "s" after ping_interval value that caused SyntaxError
    ping_interval        = 10,
    # Multi-worker Socket.IO (uncomment + set REDIS_URL):
    # message_queue      = os.getenv("REDIS_URL"),
    logger               = False,
    engineio_logger      = False,
)

# ── DB startup ────────────────────────────────────────────────────────────────
init_mongo()
initialize_database()


# ════════════════════════════════════════════════════════════════════════════════
#                    KEEP-ALIVE SCHEDULER  (anti cold-start)
# ════════════════════════════════════════════════════════════════════════════════

def _keep_alive() -> None:
    """
    Ping our own /health endpoint every 10 min.
    Render free tier spins down after 15 min of inactivity — this prevents
    the 30-60 s cold-start delay that real users would otherwise feel.
    RENDER_EXTERNAL_URL is set automatically by Render; no manual config needed.
    """
    if not SELF_URL:
        return
    try:
        resp = http_requests.get(f"{SELF_URL}/health", timeout=8)
        logger.debug("Keep-alive ping → %s %d", SELF_URL, resp.status_code)
    except Exception as exc:
        logger.warning("Keep-alive ping failed: %s", exc)


_scheduler = BackgroundScheduler(daemon=True, timezone="UTC")
_scheduler.add_job(
    _keep_alive, "interval", minutes=10,
    id="keep_alive", max_instances=1, coalesce=True,
)
_scheduler.start()
logger.info("Keep-alive scheduler started (every 10 min → %s/health)", SELF_URL or "N/A")


# ════════════════════════════════════════════════════════════════════════════════
#                         SHARED UTILITIES
# ════════════════════════════════════════════════════════════════════════════════

def _serialize(doc: dict | None) -> dict:
    """
    Convert a MongoDB document to a JSON-serialisable dict.
    • ObjectId  → str
    • datetime  → ISO-8601 string
    Returns {} for None so callers never get a TypeError.
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
    """Serialise every document in a cursor or list."""
    return [_serialize(d) for d in cursor]


def _to_object_id(value: str) -> ObjectId | None:
    """
    Safely parse an ObjectId string.
    Returns None so routes can return 400/404 cleanly instead of crashing.
    """
    try:
        return ObjectId(value)
    except (InvalidId, TypeError):
        return None


def emit_event(event: str, data: dict) -> None:
    """
    Broadcast a Socket.IO event to all connected clients.
    Errors are swallowed — a broken WebSocket must never fail an HTTP response.
    """
    try:
        socketio.emit(event, data, broadcast=True)
    except Exception as exc:
        logger.warning("Socket emit failed [%s]: %s", event, exc)


# ── Cache key groups ──────────────────────────────────────────────────────────
_CACHE_TABLES  = ["all_tables"]
_CACHE_ORDERS  = ["all_orders"]
_CACHE_FINANCE = ["total_income", "stats_daily", "stats_monthly"]


def _bust(*groups: list[str]) -> None:
    """Delete every cache key in the given groups in one call."""
    keys = [k for g in groups for k in g]
    cache.delete_many(*keys)


# ── Table ID helpers ──────────────────────────────────────────────────────────

def _coerce_table_id(value):
    """Prefer int for table_id to match how orders store it."""
    try:
        return int(value)
    except (ValueError, TypeError):
        return value


def _build_table_filter(table_id) -> dict:
    """
    Resolve a table by ObjectId _id (seeded docs), integer id, or number string.
    """
    oid = _to_object_id(str(table_id))
    if oid:
        return {"_id": oid}
    coerced = _coerce_table_id(table_id)
    return {"$or": [{"id": coerced}, {"number": str(table_id)}]}


# ── Shared projections — fetch only what each route actually returns ──────────
_PROJ_ORDER_LIST = {
    "_id": 1, "table_id": 1, "items": 1, "total": 1,
    "status": 1, "customer_name": 1, "whatsapp": 1,
    "session_id": 1, "created_at": 1,
}
_PROJ_TABLE_LIST = {"_id": 1, "number": 1, "status": 1}
_PROJ_ORDER_PAY  = {"_id": 1, "table_id": 1}


# ════════════════════════════════════════════════════════════════════════════════
#                          REQUEST TIMING MIDDLEWARE
# ════════════════════════════════════════════════════════════════════════════════

@app.before_request
def _start_timer() -> None:
    g.t0 = time.perf_counter()


@app.after_request
def _log_request(response):
    ms = (time.perf_counter() - g.get("t0", time.perf_counter())) * 1000
    if logger.isEnabledFor(logging.INFO):
        logger.info('"%s %s" %d %.1fms',
                    request.method, request.path, response.status_code, ms)
    if request.method == "GET" and response.status_code == 200:
        response.headers.setdefault("Cache-Control", "public, max-age=5")
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
    logger.warning("Duplicate key: %s", exc)
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


# ── JWT error handlers ────────────────────────────────────────────────────────

@jwt.expired_token_loader
def jwt_expired(header, payload):
    return jsonify(error="Token has expired — please log in again"), 401

@jwt.invalid_token_loader
def jwt_invalid(reason):
    return jsonify(error=f"Invalid token: {reason}"), 422

@jwt.unauthorized_loader
def jwt_missing(reason):
    return jsonify(error="Authentication token required"), 401

@jwt.revoked_token_loader
def jwt_revoked(header, payload):
    return jsonify(error="Token has been revoked"), 401


# ════════════════════════════════════════════════════════════════════════════════
#                           BLUEPRINTS
# ════════════════════════════════════════════════════════════════════════════════

# ── Tables ────────────────────────────────────────────────────────────────────

tables_bp = Blueprint("tables", __name__, url_prefix="/tables")


@tables_bp.get("")
@cache.cached(timeout=60, key_prefix="all_tables")
def get_tables():
    docs = get_collection("tables").find({}, _PROJ_TABLE_LIST)
    return jsonify([
        {"id": str(d["_id"]), "number": d["number"], "status": d["status"]}
        for d in docs
    ])


@tables_bp.put("/<table_id>")
@jwt_required()
def update_table_status(table_id):
    data = request.get_json(silent=True)
    if not data or "status" not in data:
        return jsonify(error="Status field required"), 400

    allowed = {"free", "reserved", "occupied"}
    if data["status"] not in allowed:
        return jsonify(error=f"Status must be one of: {', '.join(sorted(allowed))}"), 400

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

_ALLOWED_ORDER_STATUSES = {"pending", "preparing", "ready", "paid", "cancelled"}


@orders_bp.post("")
def create_order():
    data = request.get_json(silent=True)
    if not data:
        return jsonify(error="Invalid or missing JSON body"), 400

    session_id = data.get("session_id")
    if not session_id:
        return jsonify(error="session_id is required"), 400

    items = data.get("items", [])
    if not isinstance(items, list):
        return jsonify(error="items must be an array"), 400

    try:
        total = float(data.get("total", 0))
    except (TypeError, ValueError):
        return jsonify(error="total must be a number"), 400

    table_id = _coerce_table_id(data.get("table_id")) if data.get("table_id") else None

    doc = {
        "table_id":      table_id,
        "items":         items,
        "total":         total,
        "status":        "pending",
        "customer_name": data.get("customer_name"),
        "whatsapp":      data.get("whatsapp"),
        "session_id":    session_id,
        "created_at":    datetime.now(timezone.utc),
    }

    inserted = get_collection("orders").insert_one(doc)
    order_id = str(inserted.inserted_id)

    if table_id is not None:
        get_collection("tables").update_one(
            _build_table_filter(table_id),
            {"$set": {"status": "reserved"}},
        )

    _bust(_CACHE_TABLES, _CACHE_ORDERS, _CACHE_FINANCE)
    emit_event("new_order", {"message": "New order received", "order_id": order_id})
    return jsonify(message="Order created successfully", order_id=order_id), 201


@orders_bp.get("")
@jwt_required()
# FIX 3: added key_prefix="all_orders" — without it @cache.cached has no stable
#         key, so the cache never hits and every admin request hits MongoDB.
@cache.cached(timeout=10, key_prefix="all_orders")
def get_orders():
    docs = get_collection("orders").find({}, _PROJ_ORDER_LIST).sort("created_at", -1)
    return jsonify(_serialize_list(docs))


@orders_bp.get("/session/<session_id>")
def get_session_orders(session_id):
    if not session_id:
        return jsonify([])

    cache_key = f"session_orders_{session_id}"
    cached    = cache.get(cache_key)
    if cached is not None:
        return jsonify(cached)

    docs   = get_collection("orders").find(
        {"session_id": session_id}, _PROJ_ORDER_LIST
    ).sort("created_at", 1)
    result = _serialize_list(docs)

    cache.set(cache_key, result, timeout=10)
    return jsonify(result)


@orders_bp.get("/table/<table_id>")
def get_orders_by_table(table_id):
    session_id = request.args.get("session_id")
    if not session_id:
        return jsonify([])

    cache_key = f"table_orders_{table_id}_{session_id}"
    cached    = cache.get(cache_key)
    if cached is not None:
        return jsonify(cached)

    docs   = get_collection("orders").find(
        {"table_id": _coerce_table_id(table_id), "session_id": session_id},
        _PROJ_ORDER_LIST,
    ).sort("_id", 1)
    result = _serialize_list(docs)

    cache.set(cache_key, result, timeout=10)
    return jsonify(result)


@orders_bp.put("/<order_id>")
@jwt_required()
def update_order_status(order_id):
    data = request.get_json(silent=True)
    if not data or "status" not in data:
        return jsonify(error="Status field required"), 400

    if data["status"] not in _ALLOWED_ORDER_STATUSES:
        return jsonify(
            error=f"Status must be one of: {', '.join(sorted(_ALLOWED_ORDER_STATUSES))}"
        ), 400

    oid = _to_object_id(order_id)
    if not oid:
        return jsonify(error="Invalid order ID"), 400

    result = get_collection("orders").update_one(
        {"_id": oid},
        {"$set": {"status": data["status"]}},
    )
    if result.matched_count == 0:
        return jsonify(error="Order not found"), 404

    _bust(_CACHE_ORDERS)
    emit_event("order_updated", {"order_id": order_id})
    return jsonify(message="Status updated")

# FIX 4: removed two stray cache.clear() calls that were sitting outside any
#         function — they were executing at module import time and wiping the
#         entire cache whenever the file was loaded or a worker forked.


@orders_bp.put("/<order_id>/pay")
@jwt_required()
def mark_paid(order_id):
    oid = _to_object_id(order_id)
    if not oid:
        return jsonify(error="Invalid order ID"), 400

    orders_col = get_collection("orders")
    tables_col = get_collection("tables")

    order = orders_col.find_one({"_id": oid}, _PROJ_ORDER_PAY)
    if not order:
        return jsonify(error="Order not found"), 404

    orders_col.update_one({"_id": oid}, {"$set": {"status": "paid"}})

    table_id = order.get("table_id")
    if table_id is not None:
        tables_col.update_one(
            _build_table_filter(table_id),
            {"$set": {"status": "free"}},
        )

    _bust(_CACHE_TABLES, _CACHE_ORDERS, _CACHE_FINANCE)
    emit_event("order_updated", {"order_id": order_id})
    if table_id is not None:
        emit_event("table_updated", {"table_id": str(table_id)})

    return jsonify(message="Order marked paid and table freed")


app.register_blueprint(orders_bp)


# ── Income ────────────────────────────────────────────────────────────────────

income_bp = Blueprint("income", __name__, url_prefix="/income")


@income_bp.get("")
@jwt_required()
@cache.cached(timeout=120, key_prefix="total_income")
def total_income():
    pipeline = [
        {"$match": {"status": "paid"}},
        {"$group": {"_id": None, "income": {"$sum": "$total"}}},
    ]
    result = list(get_collection("orders").aggregate(pipeline))
    return jsonify(total_income=float(result[0]["income"]) if result else 0.0)


app.register_blueprint(income_bp)


# ── Stats ─────────────────────────────────────────────────────────────────────

stats_bp = Blueprint("stats", __name__, url_prefix="/stats")

_MONTH_NAMES = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


@stats_bp.get("/daily")
@jwt_required()
@cache.cached(timeout=300, key_prefix="stats_daily")
def stats_daily():
    """Daily revenue for last 30 days — $match first uses partial paid index."""
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
        d = doc["id"]
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
    """Monthly revenue for last 12 months — same index strategy as stats_daily."""
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
        d = doc["id"]
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
            date_str, time_str = dt.strftime("%Y-%m-%d"), dt.strftime("%H:%M")
        else:
            s = str(dt)
            date_str, time_str = s[:10], s[11:16]

        writer.writerow([
            str(doc["id"]), date_str, time_str,
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
    Render uses this for health checks; keep-alive scheduler also calls it.
    Returns 200 only when MongoDB is reachable.
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

import atexit
atexit.register(close_mongo)
atexit.register(_scheduler.shutdown, wait=False)


# ════════════════════════════════════════════════════════════════════════════════
#                              ENTRY POINT
# ════════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    logger.info("Starting server on port %d", port)
    socketio.run(app, host="0.0.0.0", port=port, debug=False)
