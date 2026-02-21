from database import get_connection
from werkzeug.security import generate_password_hash

def initialize_database():
    conn = None
    try:
        conn = get_connection()
        cursor = conn.cursor()

        # -------------------- TABLES TABLE --------------------
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS tables (
            id SERIAL PRIMARY KEY,
            number TEXT NOT NULL,
            status TEXT DEFAULT 'free'
        )
        """)

        # -------------------- ORDERS TABLE --------------------
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

        # -------------------- ADMIN TABLE --------------------
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS admin (
            id SERIAL PRIMARY KEY,
            username TEXT UNIQUE,
            password TEXT
        )
        """)

        # -------------------- INSERT DEFAULT TABLES --------------------
        cursor.execute("SELECT COUNT(*) AS count FROM tables")
        count = cursor.fetchone()["count"]

        if count == 0:
            for i in range(1, 7):
                cursor.execute(
                    "INSERT INTO tables (number, status) VALUES (%s, %s)",
                    (f"T{i}", "free")
                )

        # -------------------- INSERT DEFAULT ADMIN --------------------
        cursor.execute("SELECT COUNT(*) AS count FROM admin")
        admin_count = cursor.fetchone()["count"]

        if admin_count == 0:
            hashed_password = generate_password_hash("1234")

            cursor.execute(
                "INSERT INTO admin (username, password) VALUES (%s, %s)",
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


# Run automatically if file is executed directly
if __name__ == "__main__":
    initialize_database()
