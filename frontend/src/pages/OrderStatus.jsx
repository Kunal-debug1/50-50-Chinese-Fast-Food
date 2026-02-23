import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useHotel } from "../context/HotelContext";

const API = "https://five0-50-chinese-fast-food-6.onrender.com";

function OrderStatus() {
  const { selectedTable, endSession } = useHotel();
  const navigate = useNavigate();

  const [orders,     setOrders]     = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(new Date());

  const fetchOrders = async (showRefreshing = true) => {
    const sessionId = localStorage.getItem("sessionId");
    if (!selectedTable || !sessionId) { setLoading(false); return; }
    if (showRefreshing) setRefreshing(true);
    try {
      const res  = await fetch(`${API}/orders/table/${selectedTable.id}?session_id=${sessionId}`);
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      // ✅ Merge all orders into one unified item list
      setOrders(Array.isArray(data) ? data : []);
      setLastUpdate(new Date());
    } catch (err) {
      console.error("fetchOrders error:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { fetchOrders(false); }, [selectedTable]);

  useEffect(() => {
    const interval = setInterval(() => fetchOrders(true), 5000);
    return () => clearInterval(interval);
  }, [selectedTable]);

  // ── Derived ──────────────────────────────────────────────
  // Merge all orders' items into one flat list for display
  const allItems = orders.flatMap(o =>
    (o.items || []).map(item => ({ ...item, orderId: o.id, orderStatus: o.status }))
  ).reduce((acc, item) => {
    // Merge duplicate item names
    const existing = acc.find(i => i.name === item.name && i.orderId === item.orderId);
    if (existing) {
      existing.quantity += item.quantity;
    } else {
      acc.push({ ...item });
    }
    return acc;
  }, []);

  // ✅ Fix: parse total as number before summing
  const totalAmount = orders.reduce((sum, o) => sum + parseFloat(o.total || 0), 0);
  const allPaid     = orders.length > 0 && orders.every(o => o.status === "paid");
  const anyReady    = orders.some(o => o.status === "ready");
  const anyPending  = orders.some(o => o.status === "pending");

  // Overall status for display
  const overallStatus = allPaid ? "paid" : anyReady ? "ready" : "preparing";

  // ── Error / Loading / No session ─────────────────────────
  if (!selectedTable) {
    return (
      <div style={S.fullCenter}>
        <style>{css}</style>
        <div style={S.msgCard}>
          <div style={S.msgIcon}>⚠️</div>
          <p style={S.msgTitle}>Session expired</p>
          <p style={S.msgSub}>Please select a table to continue.</p>
          <button style={S.btnYellow} onClick={() => navigate("/")}>← Go Back</button>
        </div>
      </div>
    );
  }

  if (loading && orders.length === 0) {
    return (
      <div style={S.fullCenter}>
        <style>{css}</style>
        <div style={S.msgCard}>
          <div style={S.spinner} />
          <p style={S.msgTitle}>Loading orders...</p>
        </div>
      </div>
    );
  }

  return (
    <div style={S.page}>
      <style>{css}</style>

      <div className="card" style={S.card}>

        {/* ── HEADER ── */}
        <div style={S.header}>
          <div>
            <h2 style={S.heading}>🪑 Table {selectedTable.number}</h2>
            <p style={S.subHeading}>
              {orders.length === 0
                ? "No orders yet"
                : `${orders.length} order${orders.length > 1 ? "s" : ""} placed`}
            </p>
          </div>
          {refreshing
            ? <span style={S.liveBadge}>⟳ Updating</span>
            : <span style={{ ...S.liveBadge, background: "#E8F5E9", color: "#388E3C" }}>🟢 Live</span>
          }
        </div>

        {/* ── SUMMARY CARDS ── */}
        {orders.length > 0 && (
          <div style={S.summaryRow}>
            <div style={S.summaryCard}>
              <span style={S.summaryLabel}>Total Amount</span>
              <span style={S.summaryValue}>₹ {totalAmount.toFixed(0)}</span>
            </div>
            <div style={S.summaryCard}>
              <span style={S.summaryLabel}>Items Ordered</span>
              <span style={S.summaryValue}>{allItems.reduce((s, i) => s + i.quantity, 0)}</span>
            </div>
            <div style={{ ...S.summaryCard, flex: "0 0 auto", minWidth: "100px" }}>
              <span style={S.summaryLabel}>Status</span>
              <span style={{
                ...S.statusPill,
                background: overallStatus === "paid"  ? "#E8F5E9"
                          : overallStatus === "ready" ? "#E3F2FD"
                          : "#FFF8E1",
                color:      overallStatus === "paid"  ? "#388E3C"
                          : overallStatus === "ready" ? "#1565C0"
                          : "#F57C00",
              }}>
                {overallStatus === "paid"  ? "✓ Paid"
               : overallStatus === "ready" ? "✓ Ready"
               : "⏳ Preparing"}
              </span>
            </div>
          </div>
        )}

        {/* ── EMPTY STATE ── */}
        {orders.length === 0 ? (
          <div style={S.empty}>
            <span style={{ fontSize: "48px" }}>🛒</span>
            <p style={S.emptyTitle}>No orders yet</p>
            <p style={S.emptySub}>Add items from the menu to get started</p>
          </div>
        ) : (
          <>
            {/* ── UNIFIED ITEMS TABLE ── */}
            <div style={S.section}>
              <div style={S.sectionHead}>All Items</div>
              {allItems.map((item, i) => (
                <div key={i} style={{
                  ...S.itemRow,
                  borderLeft: `3px solid ${
                    item.orderStatus === "paid"  ? "#4CAF50" :
                    item.orderStatus === "ready" ? "#2196F3" : "#FFC107"
                  }`
                }}>
                  <span style={S.itemQty}>{item.quantity}×</span>
                  <span style={S.itemName}>{item.name}</span>
                  <span style={{
                    ...S.itemStatusDot,
                    background: item.orderStatus === "paid"  ? "#4CAF50" :
                                item.orderStatus === "ready" ? "#2196F3" : "#FFC107",
                  }} title={item.orderStatus} />
                  <span style={S.itemAmt}>₹ {(parseFloat(item.price || 0) * item.quantity).toFixed(0)}</span>
                </div>
              ))}
              {/* Total row */}
              <div style={S.totalRow}>
                <span style={S.totalLabel}>Total Payable</span>
                <span style={S.totalValue}>₹ {totalAmount.toFixed(0)}</span>
              </div>
            </div>

            {/* ── ORDER TIMELINE ── */}
            <div style={S.section}>
              <div style={S.sectionHead}>Order Timeline</div>
              {orders.map((o, i) => (
                <div key={o.id} style={S.timelineRow}>
                  <div style={{
                    ...S.timelineDot,
                    background: o.status === "paid"  ? "#4CAF50" :
                                o.status === "ready" ? "#2196F3" : "#FFC107",
                  }} />
                  <div style={S.timelineContent}>
                    <span style={S.timelineTitle}>
                      Order #{o.id} · {(o.items || []).length} item{(o.items || []).length !== 1 ? "s" : ""}
                    </span>
                    <span style={{
                      ...S.timelineStatus,
                      color: o.status === "paid"  ? "#388E3C" :
                             o.status === "ready" ? "#1565C0" : "#F57C00",
                    }}>
                      {o.status === "paid"  ? "✓ Paid" :
                       o.status === "ready" ? "✓ Ready — please collect" :
                       "⏳ Preparing..."}
                    </span>
                  </div>
                  <span style={S.timelineAmt}>₹ {parseFloat(o.total || 0).toFixed(0)}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── READY NOTICE ── */}
        {anyReady && !allPaid && (
          <div style={S.readyBanner}>
            🎉 Your order is ready! Please collect at the counter.
          </div>
        )}

        {/* ── ACTIONS ── */}
        <div style={S.actions}>
          <button style={S.btnRefresh} onClick={() => fetchOrders(true)} disabled={refreshing}>
            {refreshing ? "Refreshing..." : "⟳ Refresh"}
          </button>

          {!allPaid && (
            <button style={S.btnYellow} onClick={() => navigate("/menu")}>
              + Add More Items
            </button>
          )}

          {allPaid && (
            <button style={S.btnGreen} onClick={() => {
              localStorage.clear();
              endSession();
              navigate("/");
            }}>
              ✓ Finish & Exit
            </button>
          )}
        </div>

        {/* ── FOOTER ── */}
        <p style={S.footer}>
          Last updated: {lastUpdate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          &nbsp;· Auto-refreshes every 5s
        </p>

      </div>
    </div>
  );
}

/* ── STYLES ─────────────────────────────────────────────── */
const S = {
  page:       { minHeight: "100vh", background: "#F4F4F4", display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "20px", boxSizing: "border-box", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif" },
  fullCenter: { minHeight: "100vh", display: "flex", justifyContent: "center", alignItems: "center", padding: "20px", background: "#F4F4F4", boxSizing: "border-box" },

  card:       { background: "#FFF", borderRadius: "12px", boxShadow: "0 4px 20px rgba(0,0,0,0.08)", width: "100%", maxWidth: "520px", padding: "24px", boxSizing: "border-box", marginTop: "20px", marginBottom: "20px" },

  msgCard:    { background: "#FFF", borderRadius: "12px", padding: "40px 30px", textAlign: "center", maxWidth: "380px", width: "100%", boxShadow: "0 4px 20px rgba(0,0,0,0.08)" },
  msgIcon:    { fontSize: "48px", marginBottom: "12px" },
  msgTitle:   { fontSize: "17px", fontWeight: "700", color: "#1C1C1C", margin: "0 0 6px" },
  msgSub:     { fontSize: "13px", color: "#9C9C9C", margin: "0 0 20px" },

  spinner:    { width: "36px", height: "36px", border: "3px solid #F0F0F0", borderTop: "3px solid #FFD700", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 16px" },

  header:     { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "20px" },
  heading:    { fontSize: "22px", fontWeight: "700", color: "#1C1C1C", margin: "0 0 4px" },
  subHeading: { fontSize: "12px", color: "#9C9C9C", margin: 0 },
  liveBadge:  { fontSize: "11px", fontWeight: "600", padding: "4px 10px", borderRadius: "20px", background: "#FFF3E0", color: "#F57C00", whiteSpace: "nowrap" },

  summaryRow:   { display: "flex", gap: "10px", marginBottom: "20px", flexWrap: "wrap" },
  summaryCard:  { flex: "1 1 80px", background: "#FAFAFA", border: "1px solid #F0F0F0", borderRadius: "8px", padding: "12px", display: "flex", flexDirection: "column", gap: "4px" },
  summaryLabel: { fontSize: "10px", fontWeight: "600", color: "#9C9C9C", textTransform: "uppercase", letterSpacing: "0.4px" },
  summaryValue: { fontSize: "20px", fontWeight: "700", color: "#1C1C1C" },
  statusPill:   { fontSize: "11px", fontWeight: "700", padding: "4px 8px", borderRadius: "4px", alignSelf: "flex-start" },

  section:     { marginBottom: "16px", border: "1px solid #F0F0F0", borderRadius: "8px", overflow: "hidden" },
  sectionHead: { background: "#FAFAFA", padding: "8px 14px", fontSize: "11px", fontWeight: "700", color: "#555", textTransform: "uppercase", letterSpacing: "0.4px", borderBottom: "1px solid #F0F0F0" },

  itemRow:    { display: "flex", alignItems: "center", gap: "10px", padding: "10px 14px", borderBottom: "1px solid #F8F8F8" },
  itemQty:    { background: "#F0F0F0", color: "#555", padding: "2px 7px", borderRadius: "4px", fontSize: "12px", fontWeight: "700", minWidth: "30px", textAlign: "center", flexShrink: 0 },
  itemName:   { flex: 1, fontSize: "13px", color: "#1C1C1C" },
  itemStatusDot: { width: "7px", height: "7px", borderRadius: "50%", flexShrink: 0 },
  itemAmt:    { fontSize: "13px", fontWeight: "600", color: "#1C1C1C", flexShrink: 0 },

  totalRow:   { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", background: "#FAFAFA", borderTop: "1px solid #ECECEC" },
  totalLabel: { fontSize: "12px", fontWeight: "700", color: "#555" },
  totalValue: { fontSize: "18px", fontWeight: "700", color: "#1C1C1C" },

  timelineRow:     { display: "flex", alignItems: "flex-start", gap: "12px", padding: "12px 14px", borderBottom: "1px solid #F8F8F8" },
  timelineDot:     { width: "10px", height: "10px", borderRadius: "50%", flexShrink: 0, marginTop: "4px" },
  timelineContent: { flex: 1, display: "flex", flexDirection: "column", gap: "2px" },
  timelineTitle:   { fontSize: "13px", fontWeight: "600", color: "#1C1C1C" },
  timelineStatus:  { fontSize: "12px", fontWeight: "500" },
  timelineAmt:     { fontSize: "13px", fontWeight: "600", color: "#1C1C1C", flexShrink: 0 },

  readyBanner: { background: "#E8F5E9", border: "1px solid #A5D6A7", borderRadius: "8px", padding: "12px 16px", fontSize: "13px", fontWeight: "600", color: "#2E7D32", textAlign: "center", marginBottom: "16px" },

  actions:    { display: "flex", flexDirection: "column", gap: "10px", marginBottom: "16px" },
  btnRefresh: { width: "100%", padding: "10px", background: "#F5F5F5", border: "1px solid #E8E8E8", borderRadius: "6px", fontSize: "13px", fontWeight: "600", color: "#636363", cursor: "pointer", minHeight: "40px" },
  btnYellow:  { width: "100%", padding: "12px", background: "#FFD700", border: "none", borderRadius: "6px", fontSize: "14px", fontWeight: "700", color: "#1C1C1C", cursor: "pointer", minHeight: "46px" },
  btnGreen:   { width: "100%", padding: "12px", background: "#4CAF50", border: "none", borderRadius: "6px", fontSize: "14px", fontWeight: "700", color: "#FFF", cursor: "pointer", minHeight: "46px" },

  empty:      { textAlign: "center", padding: "40px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" },
  emptyTitle: { fontSize: "16px", fontWeight: "600", color: "#1C1C1C", margin: 0 },
  emptySub:   { fontSize: "13px", color: "#9C9C9C", margin: 0 },

  footer:     { textAlign: "center", fontSize: "11px", color: "#BCBCBC", margin: 0 },
};

/* ── RESPONSIVE CSS ──────────────────────────────────────── */
const css = `
  @keyframes spin { to { transform: rotate(360deg); } }

  * { box-sizing: border-box; }

  @media (max-width: 480px) {
    .card { padding: 16px !important; margin-top: 8px !important; }
  }

  @media (hover: none) and (pointer: coarse) {
    button { min-height: 44px !important; -webkit-tap-highlight-color: transparent; }
  }

  @media (max-width: 768px) {
    button { font-size: 16px !important; }
  }
`;

export default OrderStatus;
