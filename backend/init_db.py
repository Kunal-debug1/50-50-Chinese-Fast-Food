def initialize_database():
    from database import get_connection
    from werkzeug.security import generate_password_hash

    conn = get_connection()
    try:
        cursor = conn.cursor()

        # ============================================================
        #                        TABLES
        # ============================================================

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS tables (
                id     SERIAL PRIMARY KEY,
                number TEXT   NOT NULL,
                status TEXT   DEFAULT 'free'
            )
        """)

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS orders (
                id            SERIAL PRIMARY KEY,
                table_id      INTEGER,
                items         TEXT,
                total         NUMERIC,
                status        TEXT      DEFAULT 'preparing',
                customer_name TEXT,
                whatsapp      TEXT,
                session_id    TEXT,
                created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS admin (
                id       SERIAL PRIMARY KEY,
                username TEXT UNIQUE,
                password TEXT
            )
        """)

        # ============================================================
        #              INDEXES — dramatically speeds up lookups
        # ============================================================

        # Orders are frequently filtered by session_id and table_id
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_orders_session_id
            ON orders (session_id)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_orders_table_session
            ON orders (table_id, session_id)
        """)
        # Income query filters by status='paid'
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_orders_status
            ON orders (status)
        """)

        # ============================================================
        #                     SEED DATA
        # ============================================================

        cursor.execute("SELECT COUNT(*) FROM tables")
        if cursor.fetchone()["count"] == 0:
            for i in range(1, 7):
                cursor.execute(
                    "INSERT INTO tables (number, status) VALUES (%s, %s)",
                    (f"T{i}", "free")
                )

        cursor.execute("SELECT COUNT(*) FROM admin")
        if cursor.fetchone()["count"] == 0:
            cursor.execute(
                "INSERT INTO admin (username, password) VALUES (%s, %s)",
                ("admin", generate_password_hash("1234"))
            )

        conn.commit()

    finally:
        conn.close()
