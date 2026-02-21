import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { io } from "socket.io-client";

const API = "https://five0-50-chinese-fast-food-6.onrender.com";

function AdminDashboard() {
  const navigate = useNavigate();

  // ─── Auth ────────────────────────────────────────────────
  const [token, setToken] = useState(() => localStorage.getItem("adminToken"));

  // Redirect immediately if no token
  useEffect(() => {
    if (!token) {
      navigate("/admin-login", { replace: true });
    }
  }, [token, navigate]);

  // ─── State ───────────────────────────────────────────────
  const [tables, setTables]   = useState([]);
  const [orders, setOrders]   = useState([]);
  const [income, setIncome]   = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const audioRef  = useRef(null);
  const socketRef = useRef(null);

  // ─── Logout ──────────────────────────────────────────────
  const handleLogout = useCallback(() => {
    localStorage.removeItem("adminToken");
    setToken(null);
    if (socketRef.current) socketRef.current.disconnect();
    navigate("/admin-login", { replace: true });
  }, [navigate]);

  // ─── Fetch Helpers ───────────────────────────────────────
  const authHeaders = useCallback(() => ({
    "Content-Type": "application/json",
    Authorization: "Bearer " + token,
  }), [token]);

  const fetchTables = useCallback(async () => {
    try {
      const res = await fetch(`${API}/tables`);
      if (!res.ok) throw new Error("Failed to fetch tables");
      setTables(await res.json());
    } catch (e) {
      console.error("fetchTables:", e);
    }
  }, []);

  const fetchOrders = useCallback(async () => {
    try {
      const res = await fetch(`${API}/orders`, { headers: authHeaders() });
      if (res.status === 401) { handleLogout(); return; }
      if (!res.ok) throw new Error("Failed to fetch orders");
      setOrders(await res.json());
    } catch (e) {
      console.error("fetchOrders:", e);
    }
  }, [authHeaders, handleLogout]);

  const fetchIncome = useCallback(async () => {
    try {
      const res = await fetch(`${API}/income`, { headers: authHeaders() });
      if (res.status === 401) { handleLogout(); return; }
      if (!res.ok) throw new Error("Failed to fetch income");
      const data = await res.json();
      setIncome(data.total_income);
    } catch (e) {
      console.error("fetchIncome:", e);
    }
  }, [authHeaders, handleLogout]);

  const fetchAll = useCallback(async () => {
    await Promise.all([fetchTables(), fetchOrders(), fetchIncome()]);
  }, [fetchTables, fetchOrders, fetchIncome]);

  // ─── Sound + Notification ────────────────────────────────
  const playSound = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {});
    }
  }, []);

  const showNotification = useCallback(() => {
    if (Notification.permission === "granted") {
      new Notification("🚨 New Order Received!", {
        body: "A new order just came in!",
        icon: "/favicon.ico",
      });
    }
  }, []);

  // ─── Initial Load ────────────────────────────────────────
  useEffect(() => {
    if (!token) return;

    // Request notification permission
    if (Notification.permission === "default") {
      Notification.requestPermission();
    }

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        await fetchAll();
      } catch {
        setError("Failed to load data. Please refresh.");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [token]); // only on mount / token change

  // ─── WebSocket ───────────────────────────────────────────
  useEffect(() => {
    if (!token) return;

    const socket = io(API, {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      console.log("✅ Socket connected:", socket.id);
    });

    socket.on("disconnect", (reason) => {
      console.warn("⚠️ Socket disconnected:", reason);
    });

    socket.on("new_order", () => {
      fetchAll();
      playSound();
      showNotification();
    });

    socket.on("order_updated", () => {
      fetchAll();
    });

    socket.on("table_updated", () => {
      fetchTables();
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [token]); // reconnect only if token changes

  // ─── Order Actions ───────────────────────────────────────
  const updateOrderStatus = async (orderId, status) => {
    try {
      const res = await fetch(`${API}/orders/${orderId}`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ status }),
      });
      if (res.status === 401) { handleLogout(); return; }
      await fetchOrders();
    } catch (e) {
      console.error("updateOrderStatus:", e);
    }
  };

  const markAsPaid = async (orderId) => {
    try {
      const res = await fetch(`${API}/orders/${orderId}/pay`, {
        method: "PUT",
        headers: authHeaders(),
      });
      if (res.status === 401) { handleLogout(); return; }
      await fetchAll();
    } catch (e) {
      console.error("markAsPaid:", e);
    }
  };

  const sendWhatsAppBill = (order) => {
    playSound();

    let phone = order.whatsapp.replace(/\D/g, "");
    if (phone.length === 10) phone = "91" + phone;

    const itemsList = order.items
      .map((item, i) =>
        `${i + 1}. ${item.name}\n   Qty: ${item.quantity} × ₹${item.price}\n   Amount: ₹${item.price * item.quantity}`
      )
      .join("\n\n");

    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    const message = `
*50-50 Chinese Fast Food*
CIDCO, Chhatrapati Sambhajinagar

──────────────────
*INVOICE*
──────────────────

Order ID: ${order.id}
Table No: ${order.table_id}
Customer: ${order.customer_name}
Time: ${time}

──────────────────
*ITEM DETAILS*
──────────────────

${itemsList}

──────────────────
*TOTAL PAYABLE: ₹${order.total}*
──────────────────

Thank you for dining with us!
We look forward to serving you again.

For feedback call: +91-8830146272
`.trim();

    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, "_blank");
  };

  // ─── Derived State ───────────────────────────────────────
  const pendingOrders = orders.filter((o) => o.status !== "paid");
  const paidOrders    = orders.filter((o) => o.status === "paid");

  // ─── Guard: not logged in ────────────────────────────────
  if (!token) return null;

  // ─── Render ──────────────────────────────────────────────
  return (
    <div style={styles.container}>
      <style>{mediaQueries}</style>
      <audio ref={audioRef} src="/notification.mp3" preload="auto" />

      {/* ── NAVBAR ── */}
      <nav style={styles.navbar}>
        <div className="nav-content" style={styles.navContent}>
          <h1 className="admin-logo" style={styles.logo}>
            🍜 50-50 Admin
          </h1>
          <button
            className="logout-btn"
            style={styles.logoutBtn}
            onClick={handleLogout}
            onMouseEnter={(e) => (e.target.style.opacity = "0.85")}
            onMouseLeave={(e) => (e.target.style.opacity = "1")}
          >
            Logout
          </button>
        </div>
      </nav>

      {/* ── MAIN ── */}
      <div className="main-content" style={styles.mainContent}>

        {/* Error Banner */}
        {error && (
          <div style={styles.errorBanner}>
            ⚠️ {error}
            <button style={styles.retryBtn} onClick={fetchAll}>Retry</button>
          </div>
        )}

        {/* Loading */}
        {loading ? (
          <div style={styles.loadingState}>Loading dashboard...</div>
        ) : (
          <>
            {/* ── KPI CARDS ── */}
            <div className="kpi-grid" style={styles.kpiGrid}>
              <div className="kpi-card" style={styles.kpiCard}>
                <div className="kpi-label" style={styles.kpiLabel}>Total Income</div>
                <div className="kpi-value" style={styles.kpiValue}>₹ {income}</div>
              </div>
              <div className="kpi-card" style={styles.kpiCard}>
                <div className="kpi-label" style={styles.kpiLabel}>Total Orders</div>
                <div className="kpi-value" style={styles.kpiValue}>{orders.length}</div>
              </div>
              <div className="kpi-card" style={styles.kpiCard}>
                <div className="kpi-label" style={styles.kpiLabel}>Pending</div>
                <div className="kpi-value" style={{ ...styles.kpiValue, color: "#D32F2F" }}>
                  {pendingOrders.length}
                </div>
              </div>
              <div className="kpi-card" style={styles.kpiCard}>
                <div className="kpi-label" style={styles.kpiLabel}>Completed</div>
                <div className="kpi-value" style={{ ...styles.kpiValue, color: "#388E3C" }}>
                  {paidOrders.length}
                </div>
              </div>
            </div>

            {/* ── TABLES ── */}
            <div className="section" style={styles.section}>
              <div className="section-header" style={styles.sectionHeader}>
                <h2 className="section-title" style={styles.sectionTitle}>Table Management</h2>
                <span className="badge" style={styles.badge}>{tables.length} Tables</span>
              </div>
              <div className="tables-container" style={styles.tablesContainer}>
                {tables.map((t) => (
                  <div
                    key={t.id}
                    className="table-item"
                    style={{
                      ...styles.tableItem,
                      background: t.status === "free" ? "#F5F5F5" : "#FFF3E0",
                      borderLeft: `4px solid ${t.status === "free" ? "#388E3C" : "#F57C00"}`,
                    }}
                  >
                    <div className="table-info" style={styles.tableInfo}>
                      <div className="table-num" style={styles.tableNum}>Table {t.number}</div>
                      <div
                        className="table-status"
                        style={{ ...styles.tableStatus, color: t.status === "free" ? "#388E3C" : "#F57C00" }}
                      >
                        {t.status === "free" ? "Available" : "Occupied"}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── PENDING ORDERS ── */}
            <div className="section" style={styles.section}>
              <div className="section-header" style={styles.sectionHeader}>
                <h2 className="section-title" style={styles.sectionTitle}>Pending Orders</h2>
                <span className="badge" style={{ ...styles.badge, background: "#D32F2F", color: "#FFF" }}>
                  {pendingOrders.length}
                </span>
              </div>

              {pendingOrders.length === 0 ? (
                <div className="empty-state" style={styles.emptyState}>
                  <p>No pending orders 🎉</p>
                </div>
              ) : (
                <div className="orders-list" style={styles.ordersList}>
                  {pendingOrders.map((order) => (
                    <div key={order.id} className="order-item" style={styles.orderItem}>
                      <div className="order-item-left" style={styles.orderItemLeft}>
                        <div className="order-header" style={styles.orderHeader}>
                          <span className="order-id" style={styles.orderId}>Order #{order.id}</span>
                          <span className="table-tag" style={styles.tableTag}>Table {order.table_id}</span>
                          <span
                            style={{
                              ...styles.tableTag,
                              background: order.status === "ready" ? "#E8F5E9" : "#FFF3E0",
                              color: order.status === "ready" ? "#388E3C" : "#F57C00",
                            }}
                          >
                            {order.status.toUpperCase()}
                          </span>
                        </div>

                        <div className="order-meta" style={styles.orderMeta}>
                          <p className="customer-name" style={styles.customerName}>{order.customer_name}</p>
                          <p className="customer-phone" style={styles.customerPhone}>{order.whatsapp}</p>
                        </div>

                        <div className="items-detail" style={styles.itemsDetail}>
                          <div className="items-label" style={styles.itemsLabel}>Items:</div>
                          {order.items && order.items.length > 0 ? (
                            <div className="items-grid" style={styles.itemsGrid}>
                              {order.items.map((item, idx) => (
                                <div key={idx} className="item-row" style={styles.itemRow}>
                                  <span className="item-qty" style={styles.itemQty}>{item.quantity}x</span>
                                  <span className="item-name-detail" style={styles.itemNameDetail}>{item.name}</span>
                                  <span className="item-price-detail" style={styles.itemPriceDetail}>
                                    ₹{item.price * item.quantity}
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p style={{ margin: "4px 0", fontSize: "12px", color: "#9C9C9C" }}>No items</p>
                          )}
                        </div>
                      </div>

                      <div className="order-item-right" style={styles.orderItemRight}>
                        <div className="amount" style={styles.amount}>₹ {order.total}</div>
                        <div className="action-buttons" style={styles.actionButtons}>
                          <button
                            className="btn-primary"
                            style={styles.btnPrimary}
                            onClick={() => updateOrderStatus(order.id, "ready")}
                          >
                            Ready
                          </button>
                          <button
                            className="btn-whatsapp"
                            style={styles.btnWhatsapp}
                            onClick={() => sendWhatsAppBill(order)}
                          >
                            Send
                          </button>
                          <button
                            className="btn-secondary"
                            style={styles.btnSecondary}
                            onClick={() => markAsPaid(order.id)}
                          >
                            Paid
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ── COMPLETED ORDERS ── */}
            <div className="section" style={styles.section}>
              <div className="section-header" style={styles.sectionHeader}>
                <h2 className="section-title" style={styles.sectionTitle}>Completed Orders</h2>
                <span className="badge" style={{ ...styles.badge, background: "#388E3C", color: "#FFF" }}>
                  {paidOrders.length}
                </span>
              </div>

              {paidOrders.length === 0 ? (
                <div className="empty-state" style={styles.emptyState}>
                  <p>No completed orders</p>
                </div>
              ) : (
                <div className="orders-list" style={styles.ordersList}>
                  {paidOrders.map((order) => (
                    <div key={order.id} className="order-item completed" style={{ ...styles.orderItem, opacity: 0.7 }}>
                      <div className="order-item-left" style={styles.orderItemLeft}>
                        <div className="order-header" style={styles.orderHeader}>
                          <span className="order-id" style={styles.orderId}>Order #{order.id}</span>
                          <span className="table-tag" style={styles.tableTag}>Table {order.table_id}</span>
                        </div>
                        <div className="order-meta" style={styles.orderMeta}>
                          <p className="customer-name" style={styles.customerName}>{order.customer_name}</p>
                          <p className="customer-phone" style={styles.customerPhone}>{order.whatsapp}</p>
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                        <div className="amount" style={styles.amount}>₹ {order.total}</div>
                        <button className="btn-whatsapp" style={styles.btnWhatsapp} onClick={() => sendWhatsAppBill(order)}>
                          Send Bill
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ── STYLES ── */

const styles = {
  container: {
    background: "#F8F8F8",
    minHeight: "100vh",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    width: "100%",
    boxSizing: "border-box",
    overflowX: "hidden",
  },
  navbar: {
    background: "#FFFFFF",
    borderBottom: "1px solid #E8E8E8",
    position: "sticky",
    top: 0,
    zIndex: 100,
    boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
    width: "100%",
  },
  navContent: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    maxWidth: "1400px",
    margin: "0 auto",
    padding: "16px",
    width: "100%",
    boxSizing: "border-box",
    gap: "12px",
  },
  logo: {
    margin: 0,
    fontSize: "20px",
    fontWeight: "600",
    color: "#1C1C1C",
    letterSpacing: "-0.5px",
    flex: "1 1 auto",
  },
  logoutBtn: {
    background: "#EF4F5F",
    color: "#FFFFFF",
    border: "none",
    padding: "8px 18px",
    borderRadius: "4px",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: "500",
    minHeight: "40px",
    whiteSpace: "nowrap",
  },
  mainContent: {
    maxWidth: "1400px",
    margin: "0 auto",
    padding: "20px 16px",
    width: "100%",
    boxSizing: "border-box",
  },
  errorBanner: {
    background: "#FFEBEE",
    border: "1px solid #FFCDD2",
    color: "#C62828",
    padding: "12px 16px",
    borderRadius: "4px",
    marginBottom: "16px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: "14px",
  },
  retryBtn: {
    background: "#C62828",
    color: "#FFF",
    border: "none",
    padding: "4px 12px",
    borderRadius: "4px",
    cursor: "pointer",
    fontSize: "12px",
  },
  loadingState: {
    textAlign: "center",
    padding: "60px 20px",
    color: "#9C9C9C",
    fontSize: "16px",
  },
  kpiGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
    gap: "16px",
    marginBottom: "30px",
    width: "100%",
  },
  kpiCard: {
    background: "#FFFFFF",
    padding: "20px 24px",
    borderRadius: "6px",
    border: "1px solid #E8E8E8",
    boxSizing: "border-box",
  },
  kpiLabel: {
    fontSize: "12px",
    fontWeight: "500",
    color: "#9C9C9C",
    textTransform: "uppercase",
    letterSpacing: "0.4px",
    marginBottom: "8px",
  },
  kpiValue: {
    fontSize: "28px",
    fontWeight: "600",
    color: "#1C1C1C",
  },
  section: {
    background: "#FFFFFF",
    borderRadius: "6px",
    padding: "20px",
    marginBottom: "20px",
    border: "1px solid #E8E8E8",
    width: "100%",
    boxSizing: "border-box",
  },
  sectionHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "20px",
    paddingBottom: "16px",
    borderBottom: "1px solid #F0F0F0",
    flexWrap: "wrap",
    gap: "12px",
  },
  sectionTitle: {
    margin: 0,
    fontSize: "16px",
    fontWeight: "600",
    color: "#1C1C1C",
  },
  badge: {
    background: "#F5F5F5",
    color: "#636363",
    padding: "4px 10px",
    borderRadius: "3px",
    fontSize: "12px",
    fontWeight: "500",
    whiteSpace: "nowrap",
  },
  tablesContainer: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
    gap: "12px",
    width: "100%",
  },
  tableItem: {
    padding: "16px",
    borderRadius: "4px",
    border: "1px solid #E8E8E8",
    boxSizing: "border-box",
  },
  tableInfo: { textAlign: "center" },
  tableNum: { fontSize: "16px", fontWeight: "600", color: "#1C1C1C", marginBottom: "4px" },
  tableStatus: { fontSize: "12px", fontWeight: "500" },
  emptyState: {
    padding: "40px 20px",
    textAlign: "center",
    color: "#9C9C9C",
    fontSize: "14px",
    background: "#FAFAFA",
    borderRadius: "4px",
  },
  ordersList: { display: "flex", flexDirection: "column", gap: "12px", width: "100%" },
  orderItem: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "stretch",
    padding: "16px",
    background: "#FAFAFA",
    borderRadius: "4px",
    border: "1px solid #F0F0F0",
    gap: "16px",
    flexWrap: "wrap",
    width: "100%",
    boxSizing: "border-box",
  },
  orderItemLeft: { flex: "1 1 100%", minWidth: "200px" },
  orderItemRight: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    flexWrap: "wrap",
    flex: "1 1 auto",
    minWidth: "250px",
  },
  orderHeader: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    marginBottom: "8px",
    flexWrap: "wrap",
  },
  orderId: { fontSize: "14px", fontWeight: "600", color: "#1C1C1C" },
  tableTag: {
    background: "#E8E8E8",
    color: "#636363",
    padding: "3px 8px",
    borderRadius: "3px",
    fontSize: "11px",
    fontWeight: "500",
    whiteSpace: "nowrap",
  },
  orderMeta: { display: "flex", gap: "16px", fontSize: "13px", flexWrap: "wrap", marginBottom: "8px" },
  customerName: { margin: 0, color: "#636363", fontWeight: "500" },
  customerPhone: { margin: 0, color: "#9C9C9C", fontSize: "12px" },
  itemsDetail: { marginTop: "12px", paddingTop: "12px", borderTop: "1px solid #E8E8E8" },
  itemsLabel: { fontSize: "11px", fontWeight: "600", color: "#1C1C1C", textTransform: "uppercase", marginBottom: "6px" },
  itemsGrid: { display: "flex", flexDirection: "column", gap: "4px" },
  itemRow: { display: "flex", alignItems: "center", gap: "8px", fontSize: "12px" },
  itemQty: {
    background: "#F0F0F0",
    color: "#636363",
    padding: "2px 6px",
    borderRadius: "2px",
    fontWeight: "600",
    minWidth: "30px",
    textAlign: "center",
  },
  itemNameDetail: { color: "#636363", flex: "1 1 auto" },
  itemPriceDetail: { color: "#1C1C1C", fontWeight: "600", whiteSpace: "nowrap" },
  amount: { fontSize: "18px", fontWeight: "600", color: "#1C1C1C", whiteSpace: "nowrap" },
  actionButtons: {
    display: "flex",
    gap: "6px",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    flex: "1 1 auto",
  },
  btnPrimary: {
    background: "#388E3C", color: "#FFFFFF", border: "none",
    padding: "6px 14px", borderRadius: "4px", cursor: "pointer",
    fontSize: "12px", fontWeight: "500", whiteSpace: "nowrap", minHeight: "36px",
  },
  btnWhatsapp: {
    background: "#25D366", color: "#FFFFFF", border: "none",
    padding: "6px 14px", borderRadius: "4px", cursor: "pointer",
    fontSize: "12px", fontWeight: "500", whiteSpace: "nowrap", minHeight: "36px",
  },
  btnSecondary: {
    background: "#F57C00", color: "#FFFFFF", border: "none",
    padding: "6px 14px", borderRadius: "4px", cursor: "pointer",
    fontSize: "12px", fontWeight: "500", whiteSpace: "nowrap", minHeight: "36px",
  },
};

/* ── MEDIA QUERIES ── */
const mediaQueries = `
  * { box-sizing: border-box; }

  @media (min-width: 1024px) {
    .kpi-grid { grid-template-columns: repeat(4, 1fr) !important; }
    .order-item { flex-wrap: nowrap !important; }
    .order-item-left { flex: 1 1 auto !important; }
    .order-item-right { flex: 0 0 auto !important; }
  }

  @media (max-width: 768px) {
    .kpi-grid { grid-template-columns: repeat(2, 1fr) !important; gap: 10px !important; }
    .kpi-value { font-size: 22px !important; }
    .order-item { flex-direction: column !important; }
    .order-item-right { flex: 1 1 100% !important; min-width: auto !important; }
    .action-buttons { justify-content: stretch !important; }
    .btn-primary, .btn-whatsapp, .btn-secondary {
      flex: 1 1 calc(33.333% - 4px) !important;
      text-align: center;
      justify-content: center;
    }
    .amount { text-align: left !important; margin-bottom: 8px !important; }
    .tables-container { grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)) !important; }
  }

  @media (max-width: 480px) {
    .main-content { padding: 10px 8px !important; }
    .section { padding: 12px !important; }
    .kpi-card { padding: 12px !important; }
    .kpi-label { font-size: 10px !important; }
    .kpi-value { font-size: 18px !important; }
    .section-title { font-size: 13px !important; }
    .tables-container { grid-template-columns: repeat(auto-fill, minmax(80px, 1fr)) !important; }
    .order-id { font-size: 12px !important; }
    .btn-primary, .btn-whatsapp, .btn-secondary { font-size: 10px !important; padding: 5px 6px !important; }
  }

  @media (hover: none) and (pointer: coarse) {
    button { min-height: 44px; -webkit-tap-highlight-color: transparent; }
    .btn-primary, .btn-whatsapp, .btn-secondary { min-height: 40px !important; }
  }
`;

export default AdminDashboard;
