import os
from psycopg_pool import ConnectionPool
from psycopg.rows import dict_row

# ============================================================
#              CONNECTION POOL (created once at startup)
# ============================================================

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise Exception("DATABASE_URL environment variable not set")

# ✅ Pool keeps 2 connections open, scales up to 10 under load
# This avoids the overhead of opening a new TCP connection on every request
pool = ConnectionPool(
    conninfo=DATABASE_URL,
    min_size=2,
    max_size=10,
    kwargs={"row_factory": dict_row},
    open=True,
)


def get_connection():
    """Return a connection from the pool (auto-returned on conn.close())."""
    return pool.getconn()
