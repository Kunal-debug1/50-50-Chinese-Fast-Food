import os
import psycopg2
from psycopg2.extras import RealDictCursor


def get_connection():
    database_url = os.getenv("postgresql://admin:i4t9FWZBUAVj0k8wKydiFqaXMwGpBoBT@dpg-d6co1s95pdvs73f7ppl0-a/hotel_db_slna")

    if not database_url:
        raise Exception("DATABASE_URL environment variable not set")

    conn = psycopg2.connect(
        database_url,
        cursor_factory=RealDictCursor
    )

    return conn
