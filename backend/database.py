import os
import psycopg2
import psycopg2.extras
from psycopg2 import pool

# ============================================================
#         CONNECTION POOL — created once at startup
#   Keeps 2 connections alive, scales to 10 under load.
#   Avoids opening a new TCP connection on every request.
# ============================================================

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise Exception("DATABASE_URL environment variable not set")

connection_pool = pool.ThreadedConnectionPool(
    minconn=2,
    maxconn=10,
    dsn=DATABASE_URL,
)


def get_connection():
    """Get a connection from the pool. Call conn.close() to return it."""
    conn = connection_pool.getconn()
    # Return rows as dicts instead of tuples
    conn.cursor_factory = psycopg2.extras.RealDictCursor
    return conn


def release_connection(conn):
    """Return connection back to the pool."""
    connection_pool.putconn(conn)
