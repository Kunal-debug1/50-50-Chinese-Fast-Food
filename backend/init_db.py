"""
init_db.py — Idempotent MongoDB bootstrap
==========================================
• Verifies Atlas connectivity on startup (fast-fail with clear message)
• Creates collections — no-op if they already exist (race-safe)
• Creates all performance indexes via IndexModel (idempotent)
• Partial index on {status:"paid"} mirrors the original PostgreSQL
  WHERE status='paid' partial index — keeps stats aggregations fast
• Seeds T1-T6 restaurant tables and a default admin user
• Safe to call on every Gunicorn startup (--preload safe)
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
    existing = set(db.list_collection_names())
    for name in ("tables", "orders", "admin"):
        if name not in existing:
            try:
                db.create_collection(name)
                logger.info("Created collection: %s", name)
            except CollectionInvalid:
                pass  # another worker beat us — that's fine


# ════════════════════════════════════════════════════════════════════════════════
#                        INDEX DEFINITIONS
# ════════════════════════════════════════════════════════════════════════════════

def _ensure_indexes(db) -> None:
    """
    Create all indexes idempotently.
    PyMongo skips creation when an identical index already exists.
    All indexes are named so Mongo never creates accidental duplicates.

    orders indexes
    ──────────────
    idx_orders_session_id        — GET /orders/session/<id>
    idx_orders_table_session     — GET /orders/table/<id>?session_id=
    idx_orders_status            — admin dashboard, /income filter
    idx_orders_created_at        — most-recent-first sort in admin list
    idx_orders_paid_created      — partial covering index for /stats/daily
                                   and /stats/monthly (paid orders only)

    tables indexes
    ──────────────
    idx_tables_number (unique)   — prevent duplicate table numbers
    idx_tables_status            — filter by status

    admin indexes
    ─────────────
    idx_admin_username (unique)  — fast login lookup + uniqueness guarantee
    """
    try:
        # ── orders ────────────────────────────────────────────────────────────
        db.orders.create_indexes([
            IndexModel(
                [("session_id", ASCENDING)],
                name="idx_orders_session_id",
            ),
            IndexModel(
                [("table_id", ASCENDING), ("session_id", ASCENDING)],
                name="idx_orders_table_session",
            ),
            IndexModel(
                [("status", ASCENDING)],
                name="idx_orders_status",
            ),
            IndexModel(
                [("created_at", DESCENDING)],
                name="idx_orders_created_at",
            ),
            # Partial index — only indexes paid orders.
            # Equivalent to PostgreSQL: CREATE INDEX ... WHERE status='paid'
            # Makes /stats/daily and /stats/monthly aggregations significantly faster.
            IndexModel(
                [("status", ASCENDING), ("created_at", DESCENDING)],
                name="idx_orders_paid_created",
                partialFilterExpression={"status": "paid"},
            ),
        ])
        logger.info("Orders indexes ensured")

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
        logger.info("Tables indexes ensured")

        # ── admin ─────────────────────────────────────────────────────────────
        db.admin.create_indexes([
            IndexModel(
                [("username", ASCENDING)],
                name="idx_admin_username",
                unique=True,
            ),
        ])
        logger.info("Admin indexes ensured")

    except OperationFailure as exc:
        # Non-fatal — indexes may partially exist; log and continue
        logger.warning("Index creation warning (non-fatal): %s", exc)


# ════════════════════════════════════════════════════════════════════════════════
#                              SEED DATA
# ════════════════════════════════════════════════════════════════════════════════

def _seed_tables(db) -> None:
    """Insert T1–T6 restaurant tables if the collection is empty."""
    if db.tables.count_documents({}, limit=1) == 0:   # limit=1 is faster than full count
        db.tables.insert_many([
            {"number": f"T{i}", "status": "free"} for i in range(1, 7)
        ])
        logger.info("Seeded 6 restaurant tables (T1–T6)")


def _seed_admin(db) -> None:
    """Insert the default admin document if the collection is empty."""
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
    Idempotently bootstrap collections, indexes, and seed data.
    Raises on hard failure so Gunicorn/startup logs show a clear error
    instead of a cryptic request-time crash later.
    """
    try:
        if not ping_db():
            raise ConnectionError(
                "Cannot reach MongoDB Atlas — verify MONGO_URI and Atlas IP whitelist"
            )

        db = get_db()
        _ensure_collections(db)
        _ensure_indexes(db)
        _seed_tables(db)
        _seed_admin(db)

        logger.info("✅ MongoDB initialised successfully (db=%s)", db.name)

    except Exception as exc:
        logger.exception("❌ MongoDB initialisation failed: %s", exc)
        raise
