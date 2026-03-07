"""
init_db.py — Idempotent MongoDB bootstrap
==========================================
• Verifies Atlas connectivity on startup
• Creates collections (no-op if they already exist)
• Creates all performance indexes (idempotent)
• Seeds default restaurant tables (T1-T6) and admin user
• Safe to call on every startup
"""

import logging
from datetime import datetime, timezone

from pymongo import ASCENDING, DESCENDING, IndexModel
from pymongo.errors import CollectionInvalid

from database import get_db, ping_db

logger = logging.getLogger(__name__)

# ── Admin credentials (sourced from env in app.py) ────────────────────────────
import os
_ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "SHUBHAM")
_ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "8830146272")


# ════════════════════════════════════════════════════════════════════════════════
#                        COLLECTION + INDEX DEFINITIONS
# ════════════════════════════════════════════════════════════════════════════════

def _ensure_collections(db) -> None:
    """Create collections explicitly so validators can be attached later."""
    existing = db.list_collection_names()
    for name in ("tables", "orders", "admin"):
        if name not in existing:
            try:
                db.create_collection(name)
                logger.info("Created collection: %s", name)
            except CollectionInvalid:
                pass  # race-safe: another worker created it first


def _ensure_indexes(db) -> None:
    """
    Create all indexes idempotently.
    PyMongo skips creation if an identical index already exists.
    """
    # ── orders ────────────────────────────────────────────────────────────────
    db.orders.create_indexes([
        # Fast customer page-load lookup
        IndexModel([("session_id", ASCENDING)],  name="idx_orders_session_id"),
        # Table + session combo (get_orders_by_table)
        IndexModel([("table_id", ASCENDING), ("session_id", ASCENDING)],
                   name="idx_orders_table_session"),
        # Admin dashboard / income filter
        IndexModel([("status", ASCENDING)],      name="idx_orders_status"),
        # Most-recent-first sort (admin list)
        IndexModel([("created_at", DESCENDING)], name="idx_orders_created_at"),
        # Covering index for /stats/daily and /stats/monthly
        # Sparse partial equivalent: filter in query, index on both fields
        IndexModel([("status", ASCENDING), ("created_at", DESCENDING)],
                   name="idx_orders_status_created",
                   partialFilterExpression={"status": "paid"}),
    ])
    logger.info("Orders indexes ensured")

    # ── tables ────────────────────────────────────────────────────────────────
    db.tables.create_indexes([
        IndexModel([("number", ASCENDING)], name="idx_tables_number", unique=True),
        IndexModel([("status", ASCENDING)], name="idx_tables_status"),
    ])
    logger.info("Tables indexes ensured")

    # ── admin ─────────────────────────────────────────────────────────────────
    db.admin.create_indexes([
        IndexModel([("username", ASCENDING)], name="idx_admin_username", unique=True),
    ])
    logger.info("Admin indexes ensured")


# ════════════════════════════════════════════════════════════════════════════════
#                              SEED DATA
# ════════════════════════════════════════════════════════════════════════════════

def _seed_tables(db) -> None:
    """Insert T1-T6 restaurant tables if the collection is empty."""
    if db.tables.count_documents({}) == 0:
        db.tables.insert_many([
            {"number": f"T{i}", "status": "free"} for i in range(1, 7)
        ])
        logger.info("Seeded 6 restaurant tables (T1-T6)")


def _seed_admin(db) -> None:
    """Insert default admin credentials if none exist."""
    if db.admin.count_documents({}) == 0:
        db.admin.insert_one({
            "username":   _ADMIN_USERNAME,
            # Storing plain password as-is to match original login logic.
            # To use hashed passwords, swap to generate_password_hash here
            # and check_password_hash in the login route.
            "password":   _ADMIN_PASSWORD,
            "created_at": datetime.now(timezone.utc),
        })
        logger.info("Seeded default admin user: %s", _ADMIN_USERNAME)


# ════════════════════════════════════════════════════════════════════════════════
#                              ENTRY POINT
# ════════════════════════════════════════════════════════════════════════════════

def initialize_database() -> None:
    """Idempotently bootstrap collections, indexes, and seed data."""
    try:
        if not ping_db():
            raise ConnectionError("Cannot reach MongoDB Atlas — check MONGO_URI")

        db = get_db()
        _ensure_collections(db)
        _ensure_indexes(db)
        _seed_tables(db)
        _seed_admin(db)

        logger.info("✅ MongoDB initialized successfully (db=%s)", db.name)

    except Exception as exc:
        logger.exception("❌ MongoDB initialization failed: %s", exc)
        raise
