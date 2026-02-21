def initialize_database():
    from database import get_connection
    from werkzeug.security import generate_password_hash

    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS tables (
        id SERIAL PRIMARY KEY,
        number TEXT NOT NULL,
        status TEXT DEFAULT 'free'
    )
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        table_id INTEGER,
        items TEXT,
        total NUMERIC,
        status TEXT DEFAULT 'preparing',
        customer_name TEXT,
        whatsapp TEXT,
        session_id TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS admin (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE,
        password TEXT
    )
    """)

    cursor.execute("SELECT COUNT(*) FROM tables")
    count = cursor.fetchone()["count"]

    if count == 0:
        for i in range(1, 7):
            cursor.execute(
                "INSERT INTO tables (number, status) VALUES (%s, %s)",
                (f"T{i}", "free")
            )

    cursor.execute("SELECT COUNT(*) FROM admin")
    admin_count = cursor.fetchone()["count"]

    if admin_count == 0:
        cursor.execute(
            "INSERT INTO admin (username, password) VALUES (%s, %s)",
            ("admin", generate_password_hash("1234"))
        )

    conn.commit()
    conn.close()
