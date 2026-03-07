"""
database.py — Production-grade MongoDB Atlas connection
=========================================================
• MongoClient with connection pooling (configurable via env)
• TCP keepalives and server-selection timeout for Render deployments
• Graceful degradation: connection failure → clear error, not crash
• Simple module-level helpers mirroring the old db_conn() interface
"""

import os
import logging

from pymongo import MongoClient
from pymongo.errors import ConnectionFailure, ServerSelectionTimeoutError

logger = logging.getLogger(__name__)

# ── Environment ───────────────────────────────────────────────────────────────
MONGO_URI = os.getenv("MONGO_URI")
if not MONGO_URI:
    raise RuntimeError("MONGO_URI environment variable is not set")

DB_NAME = os.getenv("MONGO_DB_NAME", "restaurant_db")

# ── Pool configuration (tunable via env) ─────────────────────────────────────
_MAX_POOL   = int(os.getenv("MONGO_POOL_MAX", 50))   # connections per host
_MIN_POOL   = int(os.getenv("MONGO_POOL_MIN", 5))
_CONN_MS    = int(os.getenv("MONGO_CONNECT_TIMEOUT_MS",  5_000))   # 5 s
_SERVER_MS  = int(os.getenv("MONGO_SERVER_TIMEOUT_MS",  10_000))   # 10 s
_SOCKET_MS  = int(os.getenv("MONGO_SOCKET_TIMEOUT_MS",  30_000))   # 30 s

_client: MongoClient | None = None


# ════════════════════════════════════════════════════════════════════════════════
#                              INITIALISATION
# ════════════════════════════════════════════════════════════════════════════════

def init_mongo() -> None:
    """
    Create the global MongoClient.  Call once at app startup.
    Uses a single client instance — MongoClient is thread-safe and manages its
    own internal connection pool, so one instance is the recommended pattern.
    """
    global _client
    _client = MongoClient(
        MONGO_URI,
        maxPoolSize=_MAX_POOL,
        minPoolSize=_MIN_POOL,
        connectTimeoutMS=_CONN_MS,
        serverSelectionTimeoutMS=_SERVER_MS,
        socketTimeoutMS=_SOCKET_MS,
        # Retryable writes protect against transient network hiccups
        retryWrites=True,
        # Use majority write concern for durability
        w="majority",
        # Atlas requires TLS; the srv+mongodb scheme enables it automatically.
        # If using a plain mongodb:// URI on Atlas, uncomment the next line:
        # tls=True,
    )
    logger.info(
        "MongoDB client created — pool min=%d max=%d", _MIN_POOL, _MAX_POOL
    )


# ════════════════════════════════════════════════════════════════════════════════
#                              PUBLIC HELPERS
# ════════════════════════════════════════════════════════════════════════════════

def get_client() -> MongoClient:
    """Return the global MongoClient, initialising it lazily if needed."""
    global _client
    if _client is None:
        init_mongo()
    return _client  # type: ignore[return-value]


def get_db():
    """Return the restaurant_db Database object."""
    return get_client()[DB_NAME]


def get_collection(name: str):
    """Shortcut to get a named collection from restaurant_db."""
    return get_db()[name]


def ping_db() -> bool:
    """
    Check whether the server is reachable.
    Returns True on success, False on failure.
    Used by the /health endpoint.
    """
    try:
        get_client().admin.command("ping")
        return True
    except (ConnectionFailure, ServerSelectionTimeoutError) as exc:
        logger.error("MongoDB ping failed: %s", exc)
        return False
