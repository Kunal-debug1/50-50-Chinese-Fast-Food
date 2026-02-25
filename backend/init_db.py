"""
init_db.py — Idempotent database bootstrap
===========================================
• Creates tables if they don't exist
• Adds all performance indexes
• Seeds default tables + admin user
• Safe to call on every startup
"""

import logging
from werkzeug.security import generate_password_hash
from database import db_conn

logger = logging.getLogger(__name__)

# ── DDL statements ─────────────────────────────────────────────────────────────

_CREATE_TABLES_SQL = """
CREATE TABLE IF NOT EXISTS tables (
    id     SERIAL PRIMARY KEY,
    number TEXT   NOT NULL,
    status TEXT   NOT NULL DEFAULT 'free'
);

CREATE TABLE IF NOT EXISTS orders (
    id            SERIAL    PRIMARY KEY,
    table_id      INTEGER,
    items         TEXT,
    total         NUMERIC(10, 2),
    status        TEXT      NOT NULL DEFAULT 'preparing',
    customer_name TEXT,
    whatsapp      TEXT,
    session_id    TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin (
    id       SERIAL PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL
);
"""

# Covering index for the paid-orders aggregate queries used in /income + /stats/*
_CREATE_INDEXES_SQL = """
-- Fast lookup by session_id (every customer page-load)
CREATE INDEX IF NOT EXISTS idx_orders_session_id
    ON orders (session_id);

-- Fast table + session combo lookup
CREATE INDEX IF NOT EXISTS idx_orders_table_session
    ON orders (table_id, session_id);

-- Fast filter by status (admin dashboard, income)
CREATE INDEX IF NOT EXISTS idx_orders_status
    ON orders (status);

-- Fast sort for admin dashboard (most-recent first)
CREATE INDEX IF NOT EXISTS idx_orders_created_at
    ON orders (created_at DESC);

-- Covering index for /stats/daily and /stats/monthly (paid orders only)
CREATE INDEX IF NOT EXISTS idx_orders_paid_created
    ON orders (status, created_at DESC)
    WHERE status = 'paid';
"""


def initialize_database() -> None:
    """Idempotently bootstrap schema, indexes, and seed data."""
    try:
        with db_conn() as cur:
            # Schema
            cur.execute(_CREATE_TABLES_SQL)
            cur.execute(_CREATE_INDEXES_SQL)

            # Seed restaurant tables (T1-T6)
            cur.execute("SELECT COUNT(*) AS cnt FROM tables")
            if cur.fetchone()["cnt"] == 0:
                cur.executemany(
                    "INSERT INTO tables (number, status) VALUES (%s, 'free')",
                    [(f"T{i}",) for i in range(1, 7)],
                )
                logger.info("Seeded 6 restaurant tables")

            # Seed admin user
            cur.execute("SELECT COUNT(*) AS cnt FROM admin")
            if cur.fetchone()["cnt"] == 0:
                cur.execute(
                    "INSERT INTO admin (username, password) VALUES (%s, %s)",
                    ("admin", generate_password_hash("1234")),
                )
                logger.info("Seeded default admin user")

        logger.info("✅ Database initialized successfully")

    except Exception as exc:
        logger.exception("❌ Database initialization failed: %s", exc)
        raise
