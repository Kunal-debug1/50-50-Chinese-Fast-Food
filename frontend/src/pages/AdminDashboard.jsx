import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";

const API = "https://five0-50-chinese-fast-food-6.onrender.com";
const POLL_INTERVAL = 5000; // 5 seconds

function AdminDashboard() {
  const navigate   = useNavigate();
  const token      = localStorage.getItem("adminToken");

  // ─── Redirect if no token ────────────────────────────────
  useEffect(() => {
    if (!token) navigate("/admin-login", { replace: true });
  }, []);

  // ─── State ───────────────────────────────────────────────
  const [tables,  setTables]  = useState([]);
  const [orders,  setOrders]  = useState([]);
  const [income,  setIncome]  = useState(0);
  const [loading, setLoading] = useState(true);

  const audioRef        = useRef(null);
  const prevOrderCount  = useRef(null); // track new orders for notification
  const pollingRef      = useRef(null);

  // ─── Auth headers ────────────────────────────────────────
  const authGet = useCallback((url) =>
    fetch(url, { headers: { Authorization: "Bearer " + token } }),
  [token]);

  // ─── Logout ──────────────────────────────────────────────
  const handleLogout = () => {
    localStorage.removeItem("adminToken");
    clearInterval(pollingRef.current);
    navigate("/admin-login", { replace: true });
  };

  // ─── Fetch All Data ──────────────────────────────────────
  const fetchAll = useCallback(async (isBackground = false) => {
    try {
      const [tRes, oRes, iRes] = await Promise.all([
        fetch(`${API}/tables`),
        authGet(`${API}/orders`),
        authGet(`${API}/income`),
      ]);

      // Session expired
      if (oRes.status === 401 || iRes.status === 401) {
        handleLogout();
        return;
      }

      const [tData, oData, iData] = await Promise.all([
        tRes.json(),
        oRes.json(),
        iRes.json(),
      ]);

      // ── Detect new orders & trigger notification ──
      if (isBackground && prevOrderCount.current !== null) {
        const newCount = oData.filter((o) => o.status !== "paid").length;
        const oldCount = prevOrderCount.current;

        if (newCount > oldCount) {
          // 🔊 Play sound
          if (audioRef.current) {
            audioRef.current.currentTime = 0;
            audioRef.current.play().catch(() => {});
          }
          // 🔔 Notification
          if (Notification.permission === "granted") {
            new Notification("🚨 New Order Received!", {
              body: `${newCount - oldCount} new order(s) just came in!`,
              icon: "/favicon.ico",
            });
          }
        }
        prevOrderCount.current = newCount;
      } else {
        // First load — set baseline
        prevOrderCount.current = oData.filter((o) => o.status !== "paid").length;
      }

      setTables(tData);
      setOrders(oData);
      setIncome(iData.total_income ?? 0);
    } catch (e) {
      console.error("fetchAll error:", e);
    } finally {
      if (!isBackground) setLoading(false);
    }
  }, [token]);

  // ─── Initial Load + Start Polling ───────────────────────
  useEffect(() => {
    if (!token) return;

    // Ask notification permission
    if (Notification.permission === "default") {
      Notification.requestPermission();
    }

    // First load
    fetchAll(false);

    // Poll every 5 seconds
    pollingRef.current = setInterval(() => {
      fetchAll(true); // background = true → triggers notification logic
    }, POLL_INTERVAL);

    return () => clearInterval(pollingRef.current);
  }, []); // run once on mount

  // ─── Order Actions ───────────────────────────────────────
  const updateOrderStatus = async (orderId, status) => {
    await fetch(`${API}/orders/${orderId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ status }),
    });
    fetchAll(false);
  };

  const markAsPaid = async (orderId) => {
    await fetch(`${API}/orders/${orderId}/pay`, {
      method: "PUT",
      headers: { Authorization: "Bearer " + token },
    });
    fetchAll(false);
  };

  const sendWhatsAppBill = (order) => {
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {});
    }

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

  // ─── Derived ─────────────────────────────────────────────
  const pendingOrders = orders.filter((o) => o.status !== "paid");
  const paidOrders    = orders.filter((o) => o.status === "paid");

  if (!token) return null;

  // ─── Render ──────────────────────────────────────────────
  return (
    <div style={S.container}>
      <style>{mediaQueries}</style>
      <audio ref={audioRef} src="/notification.mp3" preload="auto" />

      {/* NAVBAR */}
      <nav style={S.navbar}>
        <div className="nav-content" style={S.navContent}>
          <h1 style={S.logo}>🍜 50-50 Admin</h1>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={S.liveTag}>🟢 Live</span>
            <button style={S.logoutBtn} onClick={handleLogout}>Logout</button>
          </div>
        </div>
      </nav>

      {/* MAIN */}
      <div className="main-content" style={S.mainContent}>
        {loading ? (
          <div style={S.loadingState}>Loading dashboard...</div>
        ) : (
          <>
            {/* KPI CARDS */}
            <div className="kpi-grid" style={S.kpiGrid}>
              <div className="kpi-card" style={S.kpiCard}>
                <div style={S.kpiLabel}>Total Income</div>
                <div style={S.kpiValue}>₹ {income}</div>
              </div>
              <div className="kpi-card" style={S.kpiCard}>
                <div style={S.kpiLabel}>Total Orders</div>
                <div style={S.kpiValue}>{orders.length}</div>
              </div>
              <div className="kpi-card" style={S.kpiCard}>
                <div style={S.kpiLabel}>Pending</div>
                <div style={{ ...S.kpiValue, color: "#D32F2F" }}>{pendingOrders.length}</div>
              </div>
              <div className="kpi-card" style={S.kpiCard}>
                <div style={S.kpiLabel}>Completed</div>
                <div style={{ ...S.kpiValue, color: "#388E3C" }}>{paidOrders.length}</div>
              </div>
            </div>

            {/* TABLES */}
            <div className="section" style={S.section}>
              <div style={S.sectionHeader}>
                <h2 style={S.sectionTitle}>Table Management</h2>
                <span style={S.badge}>{tables.length} Tables</span>
              </div>
              <div className="tables-container" style={S.tablesContainer}>
                {tables.map((t) => (
                  <div
                    key={t.id}
                    style={{
                      ...S.tableItem,
                      background: t.status === "free" ? "#F5F5F5" : "#FFF3E0",
                      borderLeft: `4px solid ${t.status === "free" ? "#388E3C" : "#F57C00"}`,
                    }}
                  >
                    <div style={{ textAlign: "center" }}>
                      <div style={S.tableNum}>Table {t.number}</div>
                      <div style={{ ...S.tableStatus, color: t.status === "free" ? "#388E3C" : "#F57C00" }}>
                        {t.status === "free" ? "Available" : "Occupied"}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* PENDING ORDERS */}
            <div className="section" style={S.section}>
              <div style={S.sectionHeader}>
                <h2 style={S.sectionTitle}>Pending Orders</h2>
                <span style={{ ...S.badge, background: "#D32F2F", color: "#FFF" }}>
                  {pendingOrders.length}
                </span>
              </div>

              {pendingOrders.length === 0 ? (
                <div style={S.emptyState}>No pending orders 🎉</div>
              ) : (
                <div style={S.ordersList}>
                  {pendingOrders.map((order) => (
                    <div key={order.id} className="order-item" style={S.orderItem}>
                      {/* LEFT */}
                      <div className="order-left" style={S.orderLeft}>
                        <div style={S.orderHeader}>
                          <span style={S.orderId}>Order #{order.id}</span>
                          <span style={S.tag}>Table {order.table_id}</span>
                          <span style={{
                            ...S.tag,
                            background: order.status === "ready" ? "#E8F5E9" : "#FFF3E0",
                            color: order.status === "ready" ? "#388E3C" : "#F57C00",
                          }}>
                            {order.status.toUpperCase()}
                          </span>
                        </div>
                        <div style={S.orderMeta}>
                          <span style={S.customerName}>{order.customer_name}</span>
                          <span style={S.customerPhone}>{order.whatsapp}</span>
                        </div>
                        <div style={S.itemsDetail}>
                          <div style={S.itemsLabel}>ITEMS</div>
                          {order.items?.map((item, idx) => (
                            <div key={idx} style={S.itemRow}>
                              <span style={S.itemQty}>{item.quantity}x</span>
                              <span style={S.itemName}>{item.name}</span>
                              <span style={S.itemPrice}>₹{item.price * item.quantity}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* RIGHT */}
                      <div className="order-right" style={S.orderRight}>
                        <div style={S.amount}>₹ {order.total}</div>
                        <div className="action-buttons" style={S.actionButtons}>
                          <button style={S.btnGreen}  onClick={() => updateOrderStatus(order.id, "ready")}>Ready</button>
                          <button style={S.btnWA}     onClick={() => sendWhatsAppBill(order)}>Send</button>
                          <button style={S.btnOrange} onClick={() => markAsPaid(order.id)}>Paid</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* COMPLETED ORDERS */}
            <div className="section" style={S.section}>
              <div style={S.sectionHeader}>
                <h2 style={S.sectionTitle}>Completed Orders</h2>
                <span style={{ ...S.badge, background: "#388E3C", color: "#FFF" }}>
                  {paidOrders.length}
                </span>
              </div>

              {paidOrders.length === 0 ? (
                <div style={S.emptyState}>No completed orders</div>
              ) : (
                <div style={S.ordersList}>
                  {paidOrders.map((order) => (
                    <div key={order.id} className="order-item" style={{ ...S.orderItem, opacity: 0.7 }}>
                      <div className="order-left" style={S.orderLeft}>
                        <div style={S.orderHeader}>
                          <span style={S.orderId}>Order #{order.id}</span>
                          <span style={S.tag}>Table {order.table_id}</span>
                        </div>
                        <div style={S.orderMeta}>
                          <span style={S.customerName}>{order.customer_name}</span>
                          <span style={S.customerPhone}>{order.whatsapp}</span>
                        </div>
                      </div>
                      <div className="order-right" style={S.orderRight}>
                        <div style={S.amount}>₹ {order.total}</div>
                        <button style={S.btnWA} onClick={() => sendWhatsAppBill(order)}>Send Bill</button>
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
const S = {
  container: {
    background: "#F8F8F8", minHeight: "100vh",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif",
    width: "100%", boxSizing: "border-box", overflowX: "hidden",
  },
  navbar: {
    background: "#FFFFFF", borderBottom: "1px solid #E8E8E8",
    position: "sticky", top: 0, zIndex: 100,
    boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
  },
  navContent: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    maxWidth: "1400px", margin: "0 auto", padding: "14px 16px",
    boxSizing: "border-box",
  },
  logo: { margin: 0, fontSize: "20px", fontWeight: "600", color: "#1C1C1C" },
  liveTag: {
    fontSize: "12px", fontWeight: "500", color: "#388E3C",
    background: "#E8F5E9", padding: "4px 10px", borderRadius: "20px",
  },
  logoutBtn: {
    background: "#EF4F5F", color: "#FFF", border: "none",
    padding: "8px 18px", borderRadius: "4px", cursor: "pointer",
    fontSize: "13px", fontWeight: "500", minHeight: "38px",
  },
  mainContent: {
    maxWidth: "1400px", margin: "0 auto", padding: "20px 16px",
    boxSizing: "border-box",
  },
  loadingState: { textAlign: "center", padding: "80px 20px", color: "#9C9C9C", fontSize: "16px" },
  kpiGrid: {
    display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: "16px", marginBottom: "24px",
  },
  kpiCard: {
    background: "#FFF", padding: "20px 24px", borderRadius: "6px",
    border: "1px solid #E8E8E8", boxSizing: "border-box",
  },
  kpiLabel: { fontSize: "11px", fontWeight: "600", color: "#9C9C9C", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "8px" },
  kpiValue: { fontSize: "28px", fontWeight: "700", color: "#1C1C1C" },
  section: {
    background: "#FFF", borderRadius: "6px", padding: "20px",
    marginBottom: "20px", border: "1px solid #E8E8E8", boxSizing: "border-box",
  },
  sectionHeader: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    marginBottom: "16px", paddingBottom: "14px", borderBottom: "1px solid #F0F0F0",
  },
  sectionTitle: { margin: 0, fontSize: "15px", fontWeight: "600", color: "#1C1C1C" },
  badge: { background: "#F5F5F5", color: "#636363", padding: "4px 10px", borderRadius: "20px", fontSize: "12px", fontWeight: "500" },
  tablesContainer: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: "12px" },
  tableItem: { padding: "16px", borderRadius: "4px", border: "1px solid #E8E8E8", boxSizing: "border-box" },
  tableNum: { fontSize: "15px", fontWeight: "600", color: "#1C1C1C", marginBottom: "4px", textAlign: "center" },
  tableStatus: { fontSize: "11px", fontWeight: "500", textAlign: "center" },
  emptyState: { padding: "40px", textAlign: "center", color: "#9C9C9C", background: "#FAFAFA", borderRadius: "4px" },
  ordersList: { display: "flex", flexDirection: "column", gap: "10px" },
  orderItem: {
    display: "flex", justifyContent: "space-between", alignItems: "flex-start",
    padding: "16px", background: "#FAFAFA", borderRadius: "4px",
    border: "1px solid #F0F0F0", gap: "16px", flexWrap: "wrap", boxSizing: "border-box",
  },
  orderLeft: { flex: "1 1 200px" },
  orderRight: {
    display: "flex", flexDirection: "column", alignItems: "flex-end",
    gap: "10px", flex: "0 0 auto",
  },
  orderHeader: { display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px", flexWrap: "wrap" },
  orderId: { fontSize: "14px", fontWeight: "600", color: "#1C1C1C" },
  tag: { background: "#E8E8E8", color: "#636363", padding: "2px 8px", borderRadius: "3px", fontSize: "11px", fontWeight: "500" },
  orderMeta: { display: "flex", gap: "12px", marginBottom: "10px", flexWrap: "wrap" },
  customerName: { fontSize: "13px", color: "#636363", fontWeight: "500" },
  customerPhone: { fontSize: "12px", color: "#9C9C9C" },
  itemsDetail: { borderTop: "1px solid #E8E8E8", paddingTop: "10px" },
  itemsLabel: { fontSize: "10px", fontWeight: "700", color: "#9C9C9C", letterSpacing: "0.5px", marginBottom: "6px" },
  itemRow: { display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", marginBottom: "3px" },
  itemQty: { background: "#F0F0F0", color: "#636363", padding: "1px 6px", borderRadius: "3px", fontWeight: "600", minWidth: "28px", textAlign: "center" },
  itemName: { color: "#636363", flex: 1 },
  itemPrice: { color: "#1C1C1C", fontWeight: "600" },
  amount: { fontSize: "20px", fontWeight: "700", color: "#1C1C1C" },
  actionButtons: { display: "flex", gap: "6px", flexWrap: "wrap", justifyContent: "flex-end" },
  btnGreen:  { background: "#388E3C", color: "#FFF", border: "none", padding: "7px 14px", borderRadius: "4px", cursor: "pointer", fontSize: "12px", fontWeight: "500", minHeight: "36px" },
  btnWA:     { background: "#25D366", color: "#FFF", border: "none", padding: "7px 14px", borderRadius: "4px", cursor: "pointer", fontSize: "12px", fontWeight: "500", minHeight: "36px" },
  btnOrange: { background: "#F57C00", color: "#FFF", border: "none", padding: "7px 14px", borderRadius: "4px", cursor: "pointer", fontSize: "12px", fontWeight: "500", minHeight: "36px" },
};

const mediaQueries = `
  * { box-sizing: border-box; }

  @media (min-width: 1024px) {
    .kpi-grid { grid-template-columns: repeat(4, 1fr) !important; }
    .order-item { flex-wrap: nowrap !important; }
    .order-right { flex-direction: row !important; align-items: center !important; }
  }

  @media (max-width: 768px) {
    .kpi-grid { grid-template-columns: repeat(2, 1fr) !important; gap: 10px !important; }
    .order-item { flex-direction: column !important; }
    .order-right { flex-direction: row !important; width: 100% !important; justify-content: space-between !important; align-items: center !important; }
    .action-buttons { justify-content: flex-end !important; }
    .tables-container { grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)) !important; }
  }

  @media (max-width: 480px) {
    .main-content { padding: 10px 8px !important; }
    .section { padding: 12px !important; }
    .kpi-card { padding: 14px !important; }
    .action-buttons { width: 100% !important; }
    .action-buttons button { flex: 1 !important; }
  }

  @media (hover: none) and (pointer: coarse) {
    button { min-height: 44px !important; -webkit-tap-highlight-color: transparent; }
  }
`;

export default AdminDashboard;
