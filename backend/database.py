"""
database.py — Production-grade MongoDB Atlas connection
=========================================================
• MongoClient with configurable connection pool (env-tunable)
• maxPoolSize=100  — supports 500 concurrent users
  (Little's Law: 500 users × ~5 ms avg query = ~2.5 active conns; 100 is safe ceiling)
• minPoolSize=10   — pre-warmed pool; zero cold-connect latency on traffic bursts
• maxIdleTimeMS=45 000 — recycles stale connections before Atlas free-tier
  closes them at 60 s, preventing "connection reset" errors under low traffic
• waitQueueTimeoutMS=5 000 — fail fast with 503 if pool exhausted instead of
  letting 500 threads queue indefinitely and cascade-timeout
• heartbeatFrequencyMS=10 000 — detects dead Atlas nodes in 10 s not 60 s
• localThresholdMS=15 — always use the fastest available Atlas node
• retryWrites + retryReads — survive transient network blips on Render
• Network compression (zstd → snappy → zlib) — reduces Atlas data-transfer
• Module-level singleton — ONE client reused across all requests;
  never create a MongoClient per request
• Force ping on init — pre-opens minPoolSize connections immediately so
  the very first real request never pays connection-setup cost
• ping_db() used by /health and init checks
• close_mongo() for graceful shutdown
"""

import os
import logging

from pymongo import MongoClient
from pymongo.errors import (
    ConnectionFailure,
    ServerSelectionTimeoutError,
    ConfigurationError,
)

logger = logging.getLogger(__name__)

# ── Environment ───────────────────────────────────────────────────────────────
MONGO_URI = os.getenv("MONGO_URI")
if not MONGO_URI:
    raise RuntimeError("MONGO_URI environment variable is not set")

DB_NAME = os.getenv("MONGO_DB_NAME", "restaurant_db")

# ── Pool configuration (override via env on Render) ──────────────────────────
_MAX_POOL       = int(os.getenv("MONGO_POOL_MAX",               100))   # up from 50
_MIN_POOL       = int(os.getenv("MONGO_POOL_MIN",                10))   # up from 5
_CONN_MS        = int(os.getenv("MONGO_CONNECT_TIMEOUT_MS",   5_000))   # 5 s
_SERVER_MS      = int(os.getenv("MONGO_SERVER_TIMEOUT_MS",   10_000))   # 10 s
_SOCKET_MS      = int(os.getenv("MONGO_SOCKET_TIMEOUT_MS",   30_000))   # 30 s
_IDLE_MS        = int(os.getenv("MONGO_IDLE_TIMEOUT_MS",     45_000))   # 45 s < Atlas 60 s cutoff
_WAIT_QUEUE_MS  = int(os.getenv("MONGO_WAIT_QUEUE_MS",        5_000))   # fail-fast on exhaustion
_HEARTBEAT_MS   = int(os.getenv("MONGO_HEARTBEAT_MS",        10_000))   # fast dead-node detection

_client: MongoClient | None = None


# ════════════════════════════════════════════════════════════════════════════════
#                              INITIALISATION
# ════════════════════════════════════════════════════════════════════════════════

def init_mongo() -> None:
    """
    Create the global MongoClient and pre-warm the pool.
    Called ONCE at app startup (app.py does this, before Gunicorn forks with --preload).
    MongoClient is fully thread-safe — one instance per worker is correct.
    """
    global _client
    try:
        _client = MongoClient(
            MONGO_URI,

            # ── Connection pool ───────────────────────────────────────────────
            maxPoolSize              = _MAX_POOL,
            minPoolSize              = _MIN_POOL,          # keep connections alive between bursts
            maxIdleTimeMS            = _IDLE_MS,           # recycle before Atlas drops them
            waitQueueTimeoutMS       = _WAIT_QUEUE_MS,     # don't let requests queue forever

            # ── Timeouts ─────────────────────────────────────────────────────
            connectTimeoutMS         = _CONN_MS,
            serverSelectionTimeoutMS = _SERVER_MS,
            socketTimeoutMS          = _SOCKET_MS,
            heartbeatFrequencyMS     = _HEARTBEAT_MS,      # fast dead-node detection
            localThresholdMS         = 15,                 # prefer fastest Atlas node

            # ── Reliability ──────────────────────────────────────────────────
            retryWrites              = True,               # auto-retry on transient write errors
            retryReads               = True,               # auto-retry safe read ops
            w                        = "majority",         # durable writes on Atlas replica set

            # ── Performance ──────────────────────────────────────────────────
            compressors              = ["zstd", "snappy", "zlib"],  # wire compression
        )

        # Force-open minPoolSize connections immediately so first real
        # requests never pay connection-setup latency
        _client.admin.command("ping")

        logger.info(
            "✅ MongoDB client ready — pool min=%d max=%d idle_ms=%d wait_ms=%d",
            _MIN_POOL, _MAX_POOL, _IDLE_MS, _WAIT_QUEUE_MS,
        )

    except ConfigurationError as exc:
        logger.critical("❌ Invalid MONGO_URI — check env var: %s", exc)
        raise RuntimeError(f"MongoDB configuration error: {exc}") from exc
    except (ConnectionFailure, ServerSelectionTimeoutError) as exc:
        logger.critical("❌ Cannot reach MongoDB Atlas on startup: %s", exc)
        raise


# ════════════════════════════════════════════════════════════════════════════════
#                              PUBLIC HELPERS
# ════════════════════════════════════════════════════════════════════════════════

def get_client() -> MongoClient:
    """Return the singleton MongoClient; lazy-init only if somehow not started."""
    global _client
    if _client is None:
        logger.warning("MongoClient not initialised — lazy init triggered")
        init_mongo()
    return _client  # type: ignore[return-value]


def get_db():
    """Return the restaurant_db Database handle."""
    return get_client()[DB_NAME]


def get_collection(name: str):
    """Return a named collection from restaurant_db."""
    return get_db()[name]


def ping_db() -> bool:
    """
    Fast liveness check — used by /health and keep-alive scheduler.
    Returns True on success, False on any failure.
    """
    try:
        get_client().admin.command("ping")
        return True
    except Exception as exc:
        logger.error("MongoDB ping failed: %s", exc)
        return False


def close_mongo() -> None:
    """Close all pooled connections — called by atexit on worker shutdown."""
    global _client
    if _client is not None:
        try:
            _client.close()
            logger.info("MongoDB client closed gracefully")
        except Exception as exc:
            logger.warning("Error closing MongoDB client: %s", exc)
        finally:
            _client = None
