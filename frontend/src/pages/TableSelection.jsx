import { useHotel } from "../context/HotelContext";
import { useNavigate } from "react-router-dom";
import { useState, useEffect, useRef, useCallback } from "react";
import { io } from "socket.io-client";

function TableSelection() {
  const {
    tables,
    loadingTables,
    setSelectedTable,
    fetchTables,
  } = useHotel();

  const navigate = useNavigate();
  const [hoveredId, setHoveredId] = useState(null);

  const safeTables = Array.isArray(tables) ? tables : [];

  /* ================= STABLE FETCH REFERENCE ================= */
  const fetchTablesRef = useRef(fetchTables);

  useEffect(() => {
    fetchTablesRef.current = fetchTables;
  }, [fetchTables]);

  const stableFetch = useCallback(() => {
    fetchTablesRef.current?.();
  }, []);

  /* ================= INITIAL FETCH ================= */
  useEffect(() => {
    stableFetch();
  }, [stableFetch]);

  /* ================= REAL-TIME SOCKET ================= */
  useEffect(() => {
    const socket = io("https://five0-50-chinese-fast-food-6.onrender.com");

    socket.on("table_updated", stableFetch);
    socket.on("new_order", stableFetch);

    return () => {
      socket.off("table_updated", stableFetch);
      socket.off("new_order", stableFetch);
      socket.disconnect();
    };
  }, [stableFetch]);

  /* ================= HANDLE TABLE SELECT ================= */
  const handleSelect = useCallback(
    (table) => {
      if (table.status !== "free") return;

      localStorage.setItem("selectedTable", JSON.stringify(table));
      localStorage.setItem("sessionId", Date.now().toString());
      setSelectedTable(table);
      navigate("/menu");
    },
    [setSelectedTable, navigate]
  );

  /* ================= LOADING ================= */
  if (loadingTables) {
    return (
      <div style={styles.container}>
        <div style={styles.loadingContent}>
          <div style={styles.spinner}></div>
          <p style={styles.loadingText}>
            Loading available tables...
          </p>
        </div>
      </div>
    );
  }

  const freeTables = safeTables.filter(
    (t) => t.status === "free"
  ).length;

  const totalTables = safeTables.length;

  /* ================= UI ================= */
  return (
    <div style={styles.container}>
      <div style={styles.mainContent}>
        <div style={styles.header}>
          <h1 style={styles.title}>Select Your Table</h1>
          <p style={styles.subtitle}>
            {freeTables} of {totalTables} tables available
          </p>
          <div style={styles.underline}></div>
        </div>

        <div style={styles.grid}>
          {safeTables.map((table) => {
            const isFree = table.status === "free";
            const isHovered = hoveredId === table.id;

            return (
              <div
                key={table.id}
                onClick={() => handleSelect(table)}
                onMouseEnter={() =>
                  isFree && setHoveredId(table.id)
                }
                onMouseLeave={() =>
                  setHoveredId(null)
                }
                style={{
                  ...styles.card,
                  ...(isFree
                    ? styles.cardFree
                    : styles.cardOccupied),
                  ...(isFree && isHovered
                    ? styles.cardHover
                    : {}),
                }}
              >
                <div style={styles.iconWrapper}>
                  <span style={styles.icon}>
                    {isFree ? "🍽️" : "🔒"}
                  </span>
                </div>

                <h2
                  style={{
                    ...styles.tableNumber,
                    color: isFree ? "#1C1C1C" : "#999",
                  }}
                >
                  Table {table.number}
                </h2>

                <div
                  style={{
                    ...styles.statusBadge,
                    ...(isFree
                      ? styles.statusFree
                      : styles.statusOccupied),
                  }}
                >
                  {isFree ? "Available" : "Occupied"}
                </div>
              </div>
            );
          })}
        </div>

        {safeTables.length === 0 && (
          <div style={styles.noTables}>
            <p style={styles.noTablesText}>
              No tables available at the moment
            </p>
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

/* ================= STYLES ================= */

const styles = {
  container: {
    background: "#F8F8F8",
    minHeight: "100vh",
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  },

  mainContent: {
    maxWidth: "1200px",
    margin: "0 auto",
    padding: "50px 30px",
  },

  header: {
    textAlign: "center",
    marginBottom: "50px",
  },

  title: {
    fontSize: "36px",
    fontWeight: "700",
    color: "#1C1C1C",
    margin: "0 0 8px 0",
  },

  subtitle: {
    fontSize: "14px",
    color: "#9C9C9C",
    margin: "0 0 20px 0",
    fontWeight: "500",
  },

  underline: {
    width: "80px",
    height: "4px",
    backgroundColor: "#FFD700",
    borderRadius: "2px",
    margin: "0 auto",
  },

  grid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(220px, 1fr))",
    gap: "25px",
    maxWidth: "1000px",
    margin: "0 auto",
  },

  card: {
    padding: "30px 20px",
    borderRadius: "12px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    transition: "all 0.3s ease",
    border: "2px solid transparent",
    position: "relative",
  },

  cardFree: {
    backgroundColor: "#FFFFFF",
    boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
    border: "2px solid #F0F0F0",
    cursor: "pointer",
  },

  cardHover: {
    transform: "translateY(-6px)",
    borderColor: "#FFD700",
    boxShadow:
      "0 12px 28px rgba(255, 215, 0, 0.25)",
  },

  cardOccupied: {
    backgroundColor: "#F9F9F9",
    border: "2px solid #EEEEEE",
    cursor: "not-allowed",
    opacity: 0.5,
  },

  iconWrapper: {
    marginBottom: "15px",
    background:
      "linear-gradient(135deg, #FFF9E6, #FFFBF0)",
    borderRadius: "50%",
    width: "70px",
    height: "70px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow:
      "inset 0 0 10px rgba(255, 215, 0, 0.1)",
  },

  icon: {
    fontSize: "36px",
    display: "block",
  },

  tableNumber: {
    margin: "0 0 12px 0",
    fontSize: "22px",
    fontWeight: "700",
  },

  statusBadge: {
    padding: "6px 16px",
    borderRadius: "20px",
    fontSize: "12px",
    fontWeight: "600",
    letterSpacing: "0.5px",
    textTransform: "uppercase",
  },

  statusFree: {
    backgroundColor: "#FFD700",
    color: "#1a1a1a",
  },

  statusOccupied: {
    backgroundColor: "#EEEEEE",
    color: "#999",
  },

  loadingContent: {
    height: "100vh",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    color: "#FFD700",
  },

  spinner: {
    width: "50px",
    height: "50px",
    border: "4px solid #f3f3f3",
    borderTop: "4px solid #FFD700",
    borderRadius: "50%",
    marginBottom: "20px",
    animation: "spin 1s linear infinite",
  },

  loadingText: {
    fontSize: "16px",
    fontWeight: "500",
    color: "#1C1C1C",
  },

  noTables: {
    textAlign: "center",
    padding: "60px 20px",
    background: "#FFFFFF",
    borderRadius: "8px",
    marginTop: "40px",
  },

  noTablesText: {
    fontSize: "18px",
    color: "#9C9C9C",
    margin: 0,
  },
};

export default TableSelection;
