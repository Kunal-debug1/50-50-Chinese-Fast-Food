import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";

const API           = "https://five0-50-chinese-fast-food-6.onrender.com";
const POLL_INTERVAL = 5000;

// ── Browser beep — no MP3 file needed ──────────────────────
function playBeep() {
  try {
    const ctx  = new (window.AudioContext || window.webkitAudioContext)();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.8, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.6);
  } catch (_) {}
}

function AdminDashboard() {
  const navigate = useNavigate();
  const token    = localStorage.getItem("adminToken");

  // Redirect immediately if not logged in
  useEffect(() => {
    if (!token) navigate("/admin-login", { replace: true });
  }, []);

  const [tables,  setTables]  = useState([]);
  const [orders,  setOrders]  = useState([]);
  const [income,  setIncome]  = useState(0);
  const [loading, setLoading] = useState(true);

  const prevPendingIds = useRef(null); // Set of pending order IDs from last poll
  const pollingRef     = useRef(null);

  // ── Logout ─────────────────────────────────────────────
  const handleLogout = () => {
    clearInterval(pollingRef.current);
    localStorage.removeItem("adminToken");
    navigate("/admin-login", { replace: true });
  };

  // ── Fetch everything in parallel ───────────────────────
  const fetchAll = useCallback(async (isBackground = false) => {
    try {
      const [tRes, oRes, iRes] = await Promise.all([
        fetch(`${API}/tables`),
        fetch(`${API}/orders`,  { headers: { Authorization: "Bearer " + token } }),
        fetch(`${API}/income`,  { headers: { Authorization: "Bearer " + token } }),
      ]);

      if (oRes.status === 401 || iRes.status === 401) {
        handleLogout();
        return;
      }

      const [tData, oData, iData] = await Promise.all([
        tRes.json(), oRes.json(), iRes.json(),
      ]);

      // ── Detect genuinely NEW orders (by ID, not count) ──
      if (isBackground && prevPendingIds.current !== null) {
        const currentPendingIds = new Set(
          oData.filter((o) => o.status !== "paid").map((o) => o.id)
        );
        const hasNew = [...currentPendingIds].some(
          (id) => !prevPendingIds.current.has(id)
        );

        if (hasNew) {
          // 🔊 Play once — not in a loop
          playBeep();
          // 🔔 Desktop notification
          if (Notification.permission === "granted") {
            new Notification("🚨 New Order!", {
              body: "A new order just came in!",
              icon: "/logo.png",
            });
          }
        }
        prevPendingIds.current = currentPendingIds;
      } else {
        // First load — just set baseline, no sound
        prevPendingIds.current = new Set(
          oData.filter((o) => o.status !== "paid").map((o) => o.id)
        );
      }

      setTables(tData);
      setOrders(oData);
      setIncome(iData.total_income ?? 0);
    } catch (e) {
      console.error("fetchAll:", e);
    } finally {
      if (!isBackground) setLoading(false);
    }
  }, [token]);

  // ── Mount: request permission, first load, start polling ─
  useEffect(() => {
    if (!token) return;

    if (Notification.permission === "default") {
      Notification.requestPermission();
    }

    fetchAll(false);

    pollingRef.current = setInterval(() => fetchAll(true), POLL_INTERVAL);
    return () => clearInterval(pollingRef.current);
  }, []);

  // ── Order actions ───────────────────────────────────────
  const updateStatus = async (orderId, status) => {
    await fetch(`${API}/orders/${orderId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ status }),
    });
    fetchAll(false);
  };

  const markPaid = async (orderId) => {
    await fetch(`${API}/orders/${orderId}/pay`, {
      method: "PUT",
      headers: { Authorization: "Bearer " + token },
    });
    fetchAll(false);
  };

  const sendWhatsApp = (order) => {
    let phone = order.whatsapp.replace(/\D/g, "");
    if (phone.length === 10) phone = "91" + phone;

    const itemsList = order.items
      .map((item, i) =>
        `${i + 1}. ${item.name}\n   Qty: ${item.quantity} × ₹${item.price}\n   Amount: ₹${item.price * item.quantity}`
      )
      .join("\n\n");

    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    const msg = `
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

    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, "_blank");
  };

  const pendingOrders = orders.filter((o) => o.status !== "paid");
  const paidOrders    = orders.filter((o) => o.status === "paid");

  if (!token) return null;

  // ── Render ──────────────────────────────────────────────
  return (
    <div style={S.page}>
      <style>{css}</style>

      {/* ── TOP BAR ── */}
      <div style={S.topBar}>
          <span style={S.liveTag}>🟢 Live · refreshes every 5s</span>
          <button style={S.logoutBtn} onClick={handleLogout}>Logout</button>
        </div>
      </div>

      {/* ── CONTENT ── */}
      <div className="wrap" style={S.wrap}>
        {loading ? (
          <div style={S.loader}>Loading dashboard...</div>
        ) : (
          <>
            {/* KPI */}
            <div className="kpi-grid" style={S.kpiGrid}>
              {[
                { label: "Total Income",   value: `₹ ${income}`,           color: "#1C1C1C" },
                { label: "Total Orders",   value: orders.length,            color: "#1C1C1C" },
                { label: "Pending",        value: pendingOrders.length,     color: "#D32F2F" },
                { label: "Completed",      value: paidOrders.length,        color: "#388E3C" },
              ].map((k) => (
                <div key={k.label} className="kpi-card" style={S.kpiCard}>
                  <div style={S.kpiLabel}>{k.label}</div>
                  <div style={{ ...S.kpiValue, color: k.color }}>{k.value}</div>
                </div>
              ))}
            </div>

            {/* TABLES */}
            <div style={S.section}>
              <div style={S.secHead}>
                <span style={S.secTitle}>Table Status</span>
                <span style={S.badge}>{tables.length} tables</span>
              </div>
              <div className="tbl-grid" style={S.tblGrid}>
                {tables.map((t) => (
                  <div
                    key={t.id}
                    style={{
                      ...S.tblCard,
                      background:  t.status === "free" ? "#F1F8F1" : "#FFF3E0",
                      borderColor: t.status === "free" ? "#388E3C" : "#F57C00",
                    }}
                  >
                    <div style={S.tblNum}>Table {t.number}</div>
                    <div style={{ ...S.tblStatus, color: t.status === "free" ? "#388E3C" : "#F57C00" }}>
                      {t.status === "free" ? "Available" : "Occupied"}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* PENDING ORDERS */}
            <div style={S.section}>
              <div style={S.secHead}>
                <span style={S.secTitle}>Pending Orders</span>
                <span style={{ ...S.badge, background: "#D32F2F", color: "#FFF" }}>
                  {pendingOrders.length}
                </span>
              </div>
              {pendingOrders.length === 0 ? (
                <div style={S.empty}>No pending orders 🎉</div>
              ) : (
                pendingOrders.map((o) => (
                  <div key={o.id} className="order-card" style={S.orderCard}>
                    {/* Order info */}
                    <div style={S.orderLeft}>
                      <div style={S.orderTopRow}>
                        <span style={S.orderId}>Order #{o.id}</span>
                        <span style={S.chip}>Table {o.table_id}</span>
                        <span style={{
                          ...S.chip,
                          background: o.status === "ready" ? "#E8F5E9" : "#FFF3E0",
                          color:      o.status === "ready" ? "#388E3C" : "#F57C00",
                        }}>
                          {o.status.toUpperCase()}
                        </span>
                      </div>
                      <div style={S.meta}>
                        <span style={S.metaName}>{o.customer_name}</span>
                        <span style={S.metaPhone}>{o.whatsapp}</span>
                      </div>
                      <div style={S.itemsBox}>
                        {o.items?.map((item, i) => (
                          <div key={i} style={S.itemRow}>
                            <span style={S.itemQty}>{item.quantity}x</span>
                            <span style={S.itemName}>{item.name}</span>
                            <span style={S.itemPrice}>₹{item.price * item.quantity}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    {/* Actions */}
                    <div className="order-right" style={S.orderRight}>
                      <span style={S.total}>₹ {o.total}</span>
                      <div className="btns" style={S.btns}>
                        <button style={S.btnGreen}  onClick={() => updateStatus(o.id, "ready")}>Ready</button>
                        <button style={S.btnWA}     onClick={() => sendWhatsApp(o)}>Send</button>
                        <button style={S.btnOrange} onClick={() => markPaid(o.id)}>Paid</button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* COMPLETED ORDERS */}
            <div style={S.section}>
              <div style={S.secHead}>
                <span style={S.secTitle}>Completed Orders</span>
                <span style={{ ...S.badge, background: "#388E3C", color: "#FFF" }}>
                  {paidOrders.length}
                </span>
              </div>
              {paidOrders.length === 0 ? (
                <div style={S.empty}>No completed orders</div>
              ) : (
                paidOrders.map((o) => (
                  <div key={o.id} className="order-card" style={{ ...S.orderCard, opacity: 0.65 }}>
                    <div style={S.orderLeft}>
                      <div style={S.orderTopRow}>
                        <span style={S.orderId}>Order #{o.id}</span>
                        <span style={S.chip}>Table {o.table_id}</span>
                      </div>
                      <div style={S.meta}>
                        <span style={S.metaName}>{o.customer_name}</span>
                        <span style={S.metaPhone}>{o.whatsapp}</span>
                      </div>
                    </div>
                    <div className="order-right" style={S.orderRight}>
                      <span style={S.total}>₹ {o.total}</span>
                      <button style={S.btnWA} onClick={() => sendWhatsApp(o)}>Send Bill</button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── STYLES ──────────────────────────────────────────────────
const S = {
  page:      { background: "#F4F4F4", minHeight: "100vh", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif" },
  topBar:    { background: "#FFF", borderBottom: "1px solid #E8E8E8", padding: "12px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, zIndex: 99, boxShadow: "0 1px 3px rgba(0,0,0,0.06)" },
  topTitle:  { fontSize: "18px", fontWeight: "700", color: "#1C1C1C" },
  liveTag:   { fontSize: "11px", color: "#388E3C", background: "#E8F5E9", padding: "3px 10px", borderRadius: "20px", fontWeight: "500" },
  logoutBtn: { background: "#EF4F5F", color: "#FFF", border: "none", padding: "7px 16px", borderRadius: "4px", cursor: "pointer", fontSize: "13px", fontWeight: "500" },
  wrap:      { maxWidth: "1400px", margin: "0 auto", padding: "20px 16px", boxSizing: "border-box" },
  loader:    { textAlign: "center", padding: "80px", color: "#9C9C9C", fontSize: "15px" },

  kpiGrid:   { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "14px", marginBottom: "20px" },
  kpiCard:   { background: "#FFF", padding: "18px 20px", borderRadius: "8px", border: "1px solid #E8E8E8" },
  kpiLabel:  { fontSize: "11px", fontWeight: "600", color: "#9C9C9C", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" },
  kpiValue:  { fontSize: "26px", fontWeight: "700" },

  section:   { background: "#FFF", borderRadius: "8px", padding: "18px", marginBottom: "16px", border: "1px solid #E8E8E8" },
  secHead:   { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px", paddingBottom: "12px", borderBottom: "1px solid #F0F0F0" },
  secTitle:  { fontSize: "14px", fontWeight: "700", color: "#1C1C1C" },
  badge:     { background: "#F0F0F0", color: "#636363", padding: "3px 10px", borderRadius: "20px", fontSize: "12px", fontWeight: "600" },

  tblGrid:   { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: "10px" },
  tblCard:   { padding: "14px 10px", borderRadius: "6px", border: "2px solid", textAlign: "center" },
  tblNum:    { fontSize: "14px", fontWeight: "700", color: "#1C1C1C", marginBottom: "3px" },
  tblStatus: { fontSize: "11px", fontWeight: "500" },

  empty:     { padding: "30px", textAlign: "center", color: "#9C9C9C", background: "#FAFAFA", borderRadius: "6px", fontSize: "14px" },

  orderCard: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "14px", background: "#FAFAFA", borderRadius: "6px", border: "1px solid #ECECEC", marginBottom: "10px", gap: "12px", flexWrap: "wrap" },
  orderLeft: { flex: "1 1 220px" },
  orderRight:{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "10px", flex: "0 0 auto" },

  orderTopRow: { display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap", marginBottom: "6px" },
  orderId:   { fontSize: "13px", fontWeight: "700", color: "#1C1C1C" },
  chip:      { background: "#ECECEC", color: "#555", padding: "2px 8px", borderRadius: "4px", fontSize: "11px", fontWeight: "500" },

  meta:      { display: "flex", gap: "10px", marginBottom: "10px", flexWrap: "wrap" },
  metaName:  { fontSize: "12px", color: "#555", fontWeight: "500" },
  metaPhone: { fontSize: "12px", color: "#9C9C9C" },

  itemsBox:  { borderTop: "1px solid #E8E8E8", paddingTop: "8px" },
  itemRow:   { display: "flex", gap: "8px", alignItems: "center", fontSize: "12px", marginBottom: "3px" },
  itemQty:   { background: "#ECECEC", color: "#555", padding: "1px 5px", borderRadius: "3px", fontWeight: "600", minWidth: "26px", textAlign: "center" },
  itemName:  { flex: 1, color: "#636363" },
  itemPrice: { fontWeight: "600", color: "#1C1C1C" },

  total:     { fontSize: "20px", fontWeight: "700", color: "#1C1C1C" },
  btns:      { display: "flex", gap: "6px", flexWrap: "wrap", justifyContent: "flex-end" },
  btnGreen:  { background: "#388E3C", color: "#FFF", border: "none", padding: "7px 14px", borderRadius: "4px", cursor: "pointer", fontSize: "12px", fontWeight: "600", minHeight: "34px" },
  btnWA:     { background: "#25D366", color: "#FFF", border: "none", padding: "7px 14px", borderRadius: "4px", cursor: "pointer", fontSize: "12px", fontWeight: "600", minHeight: "34px" },
  btnOrange: { background: "#F57C00", color: "#FFF", border: "none", padding: "7px 14px", borderRadius: "4px", cursor: "pointer", fontSize: "12px", fontWeight: "600", minHeight: "34px" },
};

// ── RESPONSIVE CSS ───────────────────────────────────────────
const css = `
  * { box-sizing: border-box; }

  @media (min-width: 1024px) {
    .kpi-grid  { grid-template-columns: repeat(4, 1fr) !important; }
    .order-card { flex-wrap: nowrap !important; }
    .order-right { flex-direction: row !important; align-items: center !important; }
  }

  @media (max-width: 768px) {
    .kpi-grid { grid-template-columns: repeat(2, 1fr) !important; }
    .order-card { flex-direction: column !important; }
    .order-right { flex-direction: row !important; width: 100% !important; justify-content: space-between !important; align-items: center !important; }
    .tbl-grid { grid-template-columns: repeat(auto-fill, minmax(90px, 1fr)) !important; }
  }

  @media (max-width: 480px) {
    .wrap { padding: 10px 8px !important; }
    .btns { width: 100% !important; }
    .btns button { flex: 1 !important; }
  }

  @media (hover: none) and (pointer: coarse) {
    button { min-height: 44px !important; -webkit-tap-highlight-color: transparent; }
  }
`;

export default AdminDashboard;
