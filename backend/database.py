import os
import psycopg2
from psycopg2.extras import RealDictCursor


def get_connection():
    database_url = os.getenv("DATABASE_URL")

    if not database_url:
        raise Exception("DATABASE_URL environment variable not set")

    conn = psycopg2.connect(
        database_url,
        cursor_factory=RealDictCursor
    )

    return conn