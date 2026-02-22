import os
import psycopg2
import psycopg2.extras
from psycopg2 import pool

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise Exception("DATABASE_URL environment variable not set")

# ✅ Larger pool — handles more concurrent requests without waiting
connection_pool = pool.ThreadedConnectionPool(
    minconn=2,
    maxconn=15,
    dsn=DATABASE_URL,
    # ✅ Keep connections alive — avoids reconnect overhead
    keepalives=1,
    keepalives_idle=30,
    keepalives_interval=10,
    keepalives_count=5,
)


def get_connection():
    conn = connection_pool.getconn()
    conn.cursor_factory = psycopg2.extras.RealDictCursor
    # ✅ Autocommit for SELECT-only routes = faster, no transaction overhead
    return conn


def release_connection(conn):
    connection_pool.putconn(conn)
