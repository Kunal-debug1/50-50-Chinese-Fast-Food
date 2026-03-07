"""
database.py — Production-grade MongoDB Atlas connection
=========================================================
• MongoClient with configurable connection pool (env-tunable)
• maxIdleTimeMS=45 000 — recycles stale connections before Atlas free-tier
  closes them at 60 s, preventing "connection reset" errors under low traffic
• retryWrites + retryReads — survive transient network blips on Render
• Network compression (zstd → snappy → zlib) — reduces Atlas data-transfer
• Module-level singleton — ONE client reused across all requests;
  never create a MongoClient per request
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
_MAX_POOL  = int(os.getenv("MONGO_POOL_MAX",              50))
_MIN_POOL  = int(os.getenv("MONGO_POOL_MIN",               5))
_CONN_MS   = int(os.getenv("MONGO_CONNECT_TIMEOUT_MS",  5_000))   # 5 s
_SERVER_MS = int(os.getenv("MONGO_SERVER_TIMEOUT_MS",  10_000))   # 10 s
_SOCKET_MS = int(os.getenv("MONGO_SOCKET_TIMEOUT_MS",  30_000))   # 30 s
_IDLE_MS   = int(os.getenv("MONGO_IDLE_TIMEOUT_MS",    45_000))   # 45 s < Atlas 60 s

_client: MongoClient | None = None


# ════════════════════════════════════════════════════════════════════════════════
#                              INITIALISATION
# ════════════════════════════════════════════════════════════════════════════════

def init_mongo() -> None:
    """
    Create the global MongoClient.  Call ONCE at app startup (app.py does this).
    MongoClient is fully thread-safe — one instance manages the entire pool.
    """
    global _client
    try:
        _client = MongoClient(
            MONGO_URI,
            # ── Pool ──────────────────────────────────────────────────────────
            maxPoolSize              = _MAX_POOL,
            minPoolSize              = _MIN_POOL,
            maxIdleTimeMS            = _IDLE_MS,    # proactive stale-conn cleanup
            # ── Timeouts ──────────────────────────────────────────────────────
            connectTimeoutMS         = _CONN_MS,
            serverSelectionTimeoutMS = _SERVER_MS,
            socketTimeoutMS          = _SOCKET_MS,
            # ── Reliability ───────────────────────────────────────────────────
            retryWrites              = True,         # auto-retry on transient write errors
            retryReads               = True,         # auto-retry safe read ops
            w                        = "majority",   # durable writes on Atlas replica set
            # ── Performance ───────────────────────────────────────────────────
            compressors              = ["zstd", "snappy", "zlib"],  # wire compression
        )
        logger.info(
            "MongoDB client created — pool min=%d max=%d idle_ms=%d",
            _MIN_POOL, _MAX_POOL, _IDLE_MS,
        )
    except ConfigurationError as exc:
        logger.critical("Invalid MongoDB URI — check MONGO_URI env var: %s", exc)
        raise RuntimeError(f"MongoDB configuration error: {exc}") from exc


# ════════════════════════════════════════════════════════════════════════════════
#                              PUBLIC HELPERS
# ════════════════════════════════════════════════════════════════════════════════

def get_client() -> MongoClient:
    """Return the singleton MongoClient, lazy-initialising only if missed at startup."""
    global _client
    if _client is None:
        logger.warning("MongoClient not initialised — lazy init (check startup order)")
        init_mongo()
    return _client  # type: ignore[return-value]


def get_db():
    """Return the restaurant_db Database handle."""
    return get_client()[DB_NAME]


def get_collection(name: str):
    """Shortcut — return a named collection from restaurant_db."""
    return get_db()[name]


def ping_db() -> bool:
    """
    Lightweight server liveness check.
    Returns True on success, False on any error.
    Used by /health endpoint and initialize_database().
    """
    try:
        get_client().admin.command("ping")
        return True
    except (ConnectionFailure, ServerSelectionTimeoutError) as exc:
        logger.error("MongoDB ping failed: %s", exc)
        return False
    except Exception as exc:
        logger.error("MongoDB ping unexpected error: %s", exc)
        return False


def close_mongo() -> None:
    """Gracefully close all pooled connections.  Call on app teardown."""
    global _client
    if _client is not None:
        try:
            _client.close()
            logger.info("MongoDB client closed gracefully")
        except Exception as exc:
            logger.warning("Error while closing MongoDB client: %s", exc)
        finally:
            _client = None
