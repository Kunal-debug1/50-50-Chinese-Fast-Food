from database import get_connection
from werkzeug.security import generate_password_hash

conn = None

try:
    conn = get_connection()
    cursor = conn.cursor()

    # -------------------- TABLES TABLE --------------------
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS tables (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        number TEXT NOT NULL,
        status TEXT DEFAULT 'free'
    )
    """)

    # -------------------- ORDERS TABLE --------------------
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        table_id INTEGER,
        items TEXT,
        total REAL,
        status TEXT DEFAULT 'preparing',
        customer_name TEXT,
        whatsapp TEXT,
        session_id TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """)

    # -------------------- INSERT DEFAULT TABLES --------------------
    cursor.execute("SELECT COUNT(*) FROM tables")
    count = cursor.fetchone()[0]

    if count == 0:
        for i in range(1, 7):
            cursor.execute(
                "INSERT INTO tables (number, status) VALUES (?, ?)",
                (f"T{i}", "free")
            )

    # -------------------- ADMIN TABLE --------------------
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS admin (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT
    )
    """)

    # -------------------- INSERT DEFAULT ADMIN --------------------
    cursor.execute("SELECT COUNT(*) FROM admin")
    admin_count = cursor.fetchone()[0]

    if admin_count == 0:
        hashed_password = generate_password_hash("1234")

        cursor.execute(
            "INSERT INTO admin (username, password) VALUES (?, ?)",
            ("admin", hashed_password)
        )

    conn.commit()
    print("Database initialized successfully.")

except Exception as e:
    if conn:
        conn.rollback()
    print("DATABASE ERROR:", e)

finally:
    if conn:
        conn.close()
