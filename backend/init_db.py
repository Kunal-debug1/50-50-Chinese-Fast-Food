"""
init_db.py — Idempotent MongoDB bootstrap
==========================================
• Verifies Atlas connectivity on startup (fast-fail with clear message)
• Creates collections — no-op if they already exist (race-safe)
• Creates all performance indexes via IndexModel (idempotent)
• TWO partial indexes on {status:"paid"} — one DESC for stats aggregations,
  one ASC for CSV date-range exports — both smaller and faster than full indexes
• Compound index on (table_id, session_id) for table order lookups
• Index on table_number in orders — avoids collection scans on table joins
• Seeds T1-T6 restaurant tables and a default admin user
• Safe to call on every Gunicorn startup (--preload safe)

Index coverage map
  ┌─────────────────────────────────┬──────────────────────────────────────────┐
  │ Index                           │ Query it accelerates                     │
  ├─────────────────────────────────┼──────────────────────────────────────────┤
  │ orders.session_id               │ GET /orders/session/<id>                 │
  │ orders.(table_id, session_id)   │ GET /orders/table/<id>?session_id=       │
  │ orders.status                   │ admin list filter, /income               │
  │ orders.created_at DESC          │ admin list most-recent-first sort        │
  │ orders.(status,created_at) DESC │ /stats/daily + /stats/monthly            │
  │   partial: status="paid"        │   only indexes paid docs — smaller+faster│
  │ orders.(status,created_at) ASC  │ /stats/monthly/csv date-range query      │
  │   partial: status="paid"        │   same partial filter, ASC for CSV sort  │
  │ orders.table_number             │ table_number lookups in order docs       │
  ├─────────────────────────────────┼──────────────────────────────────────────┤
  │ tables.number (unique)          │ seed guard + table number uniqueness     │
  │ tables.status                   │ filter free / reserved / occupied tables │
  ├─────────────────────────────────┼──────────────────────────────────────────┤
  │ admin.username (unique)         │ login lookup + uniqueness guarantee      │
  └─────────────────────────────────┴──────────────────────────────────────────┘
"""

import os
import logging
from datetime import datetime, timezone

from pymongo import ASCENDING, DESCENDING, IndexModel
from pymongo.errors import CollectionInvalid, OperationFailure

from database import get_db, ping_db

logger = logging.getLogger(__name__)

# ── Seed credentials (same env vars as app.py admin login) ───────────────────
_ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "SHUBHAM")
_ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "8830146272")


# ════════════════════════════════════════════════════════════════════════════════
#                        COLLECTION CREATION
# ════════════════════════════════════════════════════════════════════════════════

def _ensure_collections(db) -> None:
    """
    Explicitly create collections so schema validators can be attached later.
    Silently skips if a collection already exists (CollectionInvalid is expected
    on subsequent startups).
    """
    existing = set(db.list_collection_names())   # set → O(1) membership test
    for name in ("tables", "orders", "admin"):
        if name not in existing:
            try:
                db.create_collection(name)
                logger.info("Created collection: %s", name)
            except CollectionInvalid:
                pass  # another worker beat us — race-safe


# ════════════════════════════════════════════════════════════════════════════════
#                        INDEX DEFINITIONS
# ════════════════════════════════════════════════════════════════════════════════

def _ensure_indexes(db) -> None:
    """
    Create all indexes idempotently.
    PyMongo skips creation when an identical index (same keys + options) already exists.
    All indexes are explicitly named — prevents duplicate creation across restarts.
    """
    try:
        # ── orders ────────────────────────────────────────────────────────────
        db.orders.create_indexes([

            # Customer session lookup — hit on every order page load
            IndexModel(
                [("session_id", ASCENDING)],
                name="idx_orders_session_id",
            ),

            # Table + session combo — GET /orders/table/<id>?session_id=
            IndexModel(
                [("table_id", ASCENDING), ("session_id", ASCENDING)],
                name="idx_orders_table_session",
            ),

            # Status filter — admin dashboard, /income total
            IndexModel(
                [("status", ASCENDING)],
                name="idx_orders_status",
            ),

            # Most-recent-first sort — admin orders list
            IndexModel(
                [("created_at", DESCENDING)],
                name="idx_orders_created_at",
            ),

            # ── PARTIAL COVERING INDEX — /stats/daily + /stats/monthly ────────
            # Only indexes documents where status="paid" → much smaller index
            # than a full (status, created_at) index. The $match stage in every
            # aggregation pipeline hits this index before doing any $group work.
            # Equivalent to PostgreSQL: CREATE INDEX ... WHERE status='paid'
            IndexModel(
                [("status", ASCENDING), ("created_at", DESCENDING)],
                name="idx_orders_paid_desc",
                partialFilterExpression={"status": "paid"},
            ),

            # ── PARTIAL INDEX — /stats/monthly/csv date-range export ──────────
            # Same partial filter but ASC — matches the CSV sort order so
            # MongoDB can satisfy the sort from the index without a sort stage.
            IndexModel(
                [("status", ASCENDING), ("created_at", ASCENDING)],
                name="idx_orders_paid_asc",
                partialFilterExpression={"status": "paid"},
            ),

            # table_number stored on order docs — avoids secondary lookups
            # when filtering or displaying orders by table number
            IndexModel(
                [("table_number", ASCENDING)],
                name="idx_orders_table_number",
                sparse=True,   # sparse=True skips docs where table_number is absent
            ),
        ])
        logger.info("Orders indexes ensured ✅")

        # ── tables ────────────────────────────────────────────────────────────
        db.tables.create_indexes([
            IndexModel(
                [("number", ASCENDING)],
                name="idx_tables_number",
                unique=True,
            ),
            IndexModel(
                [("status", ASCENDING)],
                name="idx_tables_status",
            ),
        ])
        logger.info("Tables indexes ensured ✅")

        # ── admin ─────────────────────────────────────────────────────────────
        db.admin.create_indexes([
            IndexModel(
                [("username", ASCENDING)],
                name="idx_admin_username",
                unique=True,
            ),
        ])
        logger.info("Admin indexes ensured ✅")

    except OperationFailure as exc:
        # Non-fatal — indexes may partially exist from a previous deploy
        logger.warning("Index creation warning (non-fatal): %s", exc)


# ════════════════════════════════════════════════════════════════════════════════
#                              SEED DATA
# ════════════════════════════════════════════════════════════════════════════════

def _seed_tables(db) -> None:
    """Insert T1–T6 restaurant tables if the collection is empty.
    limit=1 avoids a full collection count scan on every startup."""
    if db.tables.count_documents({}, limit=1) == 0:
        db.tables.insert_many([
            {"number": f"T{i}", "status": "free"} for i in range(1, 7)
        ])
        logger.info("Seeded 6 restaurant tables (T1–T6)")


def _seed_admin(db) -> None:
    """Insert default admin if collection is empty.
    limit=1 avoids a full collection count scan on every startup."""
    if db.admin.count_documents({}, limit=1) == 0:
        db.admin.insert_one({
            "username":   _ADMIN_USERNAME,
            "password":   _ADMIN_PASSWORD,
            "created_at": datetime.now(timezone.utc),
        })
        logger.info("Seeded default admin user: %s", _ADMIN_USERNAME)


# ════════════════════════════════════════════════════════════════════════════════
#                              ENTRY POINT
# ════════════════════════════════════════════════════════════════════════════════

def initialize_database() -> None:
    """
    Bootstrap collections, indexes, and seed data.
    Fast-fails with a clear error if Atlas is unreachable so Gunicorn logs
    show the real problem instead of a cryptic crash on the first request.
    """
    try:
        if not ping_db():
            raise ConnectionError(
                "Cannot reach MongoDB Atlas — verify MONGO_URI and Atlas IP whitelist (0.0.0.0/0)"
            )

        db = get_db()
        _ensure_collections(db)
        _ensure_indexes(db)
        _seed_tables(db)
        _seed_admin(db)

        logger.info("✅ Database initialised successfully (db=%s)", db.name)

    except Exception as exc:
        logger.exception("❌ Database initialisation failed: %s", exc)
        raise
