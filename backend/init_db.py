def initialize_database():
    from database import get_connection, release_connection
    from werkzeug.security import generate_password_hash

    conn = get_connection()
    try:
        cursor = conn.cursor()

        # ============================================================
        #                     CREATE TABLES
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
        #       INDEXES — critical for fast queries on large tables
        # ============================================================

        # Fast lookup by session_id (used on every customer page load)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_orders_session_id
            ON orders (session_id)
        """)

        # Fast lookup for table + session combo
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_orders_table_session
            ON orders (table_id, session_id)
        """)

        # Fast filter for paid/pending (used in admin + income)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_orders_status
            ON orders (status)
        """)

        # Fast sort for admin dashboard (most recent first)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_orders_created_at
            ON orders (created_at DESC)
        """)

        # ============================================================
        #                      SEED DATA
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
        print("✅ Database initialized successfully")

    except Exception as e:
        conn.rollback()
        print(f"❌ Database init error: {e}")
        raise
    finally:
        release_connection(conn)
