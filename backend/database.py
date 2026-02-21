import os
import psycopg
from psycopg.rows import dict_row


def get_connection():
    database_url = os.getenv("DATABASE_URL")

    if not database_url:
        raise Exception("DATABASE_URL environment variable not set")

    conn = psycopg.connect(
        database_url,
        row_factory=dict_row
    )

    return conn
