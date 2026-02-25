"""
database.py — Production-grade PostgreSQL connection pool
=========================================================
• ThreadedConnectionPool with configurable min/max from env
• TCP keepalives to prevent stale connections on Render
• Graceful degradation: pool exhaustion → clear error, not crash
• Context-manager helper for safe acquire/release
"""

import os
import logging
from contextlib import contextmanager

import psycopg2
import psycopg2.extras
from psycopg2 import pool as pg_pool
from psycopg2 import OperationalError

logger = logging.getLogger(__name__)

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL environment variable is not set")

# ── Pool configuration (tunable via env) ──────────────────────────────────────
_MIN_CONN = int(os.getenv("DB_POOL_MIN", 2))
_MAX_CONN = int(os.getenv("DB_POOL_MAX", 15))

_pool: pg_pool.ThreadedConnectionPool | None = None


def _create_pool() -> pg_pool.ThreadedConnectionPool:
    """Create a new connection pool with TCP keepalives."""
    return pg_pool.ThreadedConnectionPool(
        minconn=_MIN_CONN,
        maxconn=_MAX_CONN,
        dsn=DATABASE_URL,
        # TCP keepalives — essential on Render to avoid silent drops
        keepalives=1,
        keepalives_idle=30,
        keepalives_interval=10,
        keepalives_count=5,
    )


def init_pool() -> None:
    """Initialise the global pool.  Call once at app startup."""
    global _pool
    _pool = _create_pool()
    logger.info("PostgreSQL connection pool created (min=%d, max=%d)", _MIN_CONN, _MAX_CONN)


def get_connection() -> psycopg2.extensions.connection:
    """
    Acquire a connection from the pool.
    Automatically sets RealDictCursor as the default cursor factory.
    Raises RuntimeError if the pool is exhausted.
    """
    global _pool
    if _pool is None:
        init_pool()
    try:
        conn = _pool.getconn()
        conn.cursor_factory = psycopg2.extras.RealDictCursor
        return conn
    except pg_pool.PoolError as exc:
        logger.error("Connection pool exhausted: %s", exc)
        raise RuntimeError("Database connection pool exhausted — try again shortly") from exc


def release_connection(conn: psycopg2.extensions.connection, *, error: bool = False) -> None:
    """
    Return a connection to the pool.
    Pass error=True to discard a broken connection instead of recycling it.
    """
    global _pool
    if _pool is None:
        return
    try:
        if error:
            # Force-close so the pool doesn't recycle a broken socket
            try:
                conn.close()
            except Exception:
                pass
            _pool.putconn(conn, close=True)
        else:
            _pool.putconn(conn)
    except Exception as exc:
        logger.warning("Failed to release connection: %s", exc)


@contextmanager
def db_conn(autocommit: bool = False):
    """
    Context manager for safe connection use.

    Usage (read-only, no explicit commit needed):
        with db_conn() as cur:
            cur.execute("SELECT ...")
            rows = cur.fetchall()

    Usage (write, commits automatically on success):
        with db_conn() as cur:
            cur.execute("INSERT ...")
        # committed here

    On exception: rolls back and re-raises.
    """
    conn = get_connection()
    broken = False
    try:
        if autocommit:
            conn.set_session(autocommit=True)
        cur = conn.cursor()
        yield cur
        if not autocommit:
            conn.commit()
    except OperationalError as exc:
        broken = True
        try:
            conn.rollback()
        except Exception:
            pass
        logger.error("DB operational error: %s", exc)
        raise
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    finally:
        release_connection(conn, error=broken)
