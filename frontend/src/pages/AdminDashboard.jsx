import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";

const API           = "https://five0-50-chinese-fast-food-6.onrender.com";
const POLL_INTERVAL = 5000;

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

// ── Month options for CSV picker ──
function getMonthOptions() {
  const opts = [];
  const now  = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleString("default", { month: "long", year: "numeric" });
    opts.push({ value, label });
  }
  return opts;
}

function AdminDashboard() {
  const navigate = useNavigate();
  const token    = localStorage.getItem("adminToken");

  useEffect(() => {
    if (!token) navigate("/admin-login", { replace: true });
  }, []);

  // ── tabs: "orders" | "stats" ──
  const [tab,        setTab]        = useState("orders");
  const [tables,     setTables]     = useState([]);
  const [orders,     setOrders]     = useState([]);
  const [income,     setIncome]     = useState(0);
  const [loading,    setLoading]    = useState(true);
  const [itemStatus, setItemStatus] = useState({});

  // stats state
  const [daily,        setDaily]        = useState([]);
  const [monthly,      setMonthly]      = useState([]);
  const [statsLoading, setStatsLoading] = useState(false);
  const [csvMonth,     setCsvMonth]     = useState(getMonthOptions()[0].value);
  const [csvLoading,   setCsvLoading]   = useState(false);

  const prevPendingIds = useRef(null);
  const pollingRef     = useRef(null);

  const handleLogout = () => {
    clearInterval(pollingRef.current);
    localStorage.removeItem("adminToken");
    navigate("/admin-login", { replace: true });
  };

  const authH = () => ({ Authorization: "Bearer " + token });

  // ── Fetch orders / tables / income ──
  const fetchAll = useCallback(async (isBackground = false) => {
    try {
      const [tRes, oRes, iRes] = await Promise.all([
        fetch(`${API}/tables`),
        fetch(`${API}/orders`, { headers: authH() }),
        fetch(`${API}/income`, { headers: authH() }),
      ]);

      if (oRes.status === 401 || iRes.status === 401) { handleLogout(); return; }

      const [tData, oData, iData] = await Promise.all([
        tRes.json(), oRes.json(), iRes.json(),
      ]);

      if (isBackground && prevPendingIds.current !== null) {
        const currentIds = new Set(oData.filter(o => o.status !== "paid").map(o => o.id));
        const hasNew = [...currentIds].some(id => !prevPendingIds.current.has(id));
        if (hasNew) {
          playBeep();
          if (Notification.permission === "granted") {
            new Notification("🚨 New Order!", { body: "A new order just came in!", icon: "/logo.png" });
          }
          setItemStatus(prev => {
            const next = { ...prev };
            oData.filter(o => o.status !== "paid" && !prev[o.id]).forEach(o => {
              next[o.id] = Object.fromEntries((o.items || []).map((_, i) => [i, "pending"]));
            });
            return next;
          });
        }
        prevPendingIds.current = currentIds;
      } else {
        prevPendingIds.current = new Set(oData.filter(o => o.status !== "paid").map(o => o.id));
        setItemStatus(prev => {
          const next = { ...prev };
          oData.filter(o => o.status !== "paid" && !prev[o.id]).forEach(o => {
            next[o.id] = Object.fromEntries((o.items || []).map((_, i) => [i, "pending"]));
          });
          return next;
        });
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

  // ── Fetch stats ──
  const fetchStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const [dRes, mRes] = await Promise.all([
        fetch(`${API}/stats/daily`,   { headers: authH() }),
        fetch(`${API}/stats/monthly`, { headers: authH() }),
      ]);
      if (dRes.ok) setDaily(await dRes.json());
      if (mRes.ok) setMonthly(await mRes.json());
    } catch (e) {
      console.error("fetchStats:", e);
    } finally {
      setStatsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    if (Notification.permission === "default") Notification.requestPermission();
    fetchAll(false);
    pollingRef.current = setInterval(() => fetchAll(true), POLL_INTERVAL);
    return () => clearInterval(pollingRef.current);
  }, []);

  // Load stats when switching to stats tab
  useEffect(() => {
    if (tab === "stats" && daily.length === 0) fetchStats();
  }, [tab]);

  // ── CSV download ──
  const downloadCSV = async () => {
    setCsvLoading(true);
    try {
      const res = await fetch(`${API}/stats/monthly/csv?month=${csvMonth}`, {
        headers: authH(),
      });
      if (!res.ok) throw new Error("Failed");
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `orders_${csvMonth}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert("Failed to download CSV. Try again.");
    } finally {
      setCsvLoading(false);
    }
  };

  // ── Order actions ──
  const toggleItem = (orderId, itemIdx) => {
    setItemStatus(prev => ({
      ...prev,
      [orderId]: {
        ...prev[orderId],
        [itemIdx]: prev[orderId]?.[itemIdx] === "ready" ? "pending" : "ready",
      },
    }));
  };

  const updateStatus = async (orderId, status) => {
    await fetch(`${API}/orders/${orderId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authH() },
      body: JSON.stringify({ status }),
    });
    if (status === "ready") {
      setItemStatus(prev => {
        const order = orders.find(o => o.id === orderId);
        if (!order) return prev;
        return { ...prev, [orderId]: Object.fromEntries((order.items || []).map((_, i) => [i, "ready"])) };
      });
    }
    fetchAll(false);
  };

  const markPaid = async (orderId) => {
    await fetch(`${API}/orders/${orderId}/pay`, { method: "PUT", headers: authH() });
    setItemStatus(prev => { const n = { ...prev }; delete n[orderId]; return n; });
    fetchAll(false);
    // Refresh stats if on stats tab
    if (tab === "stats") fetchStats();
  };

  const sendWhatsApp = (order) => {
    let phone = order.whatsapp.replace(/\D/g, "");
    if (phone.length === 10) phone = "91" + phone;
    const itemsList = order.items.map((item, i) =>
      `${i + 1}. ${item.name}\n   Qty: ${item.quantity} × ₹${item.price}\n   Amount: ₹${item.price * item.quantity}`
    ).join("\n\n");
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const msg = `*50-50 CHINESE FAST FOOD*\nCIDCO, Chhatrapati Sambhajinagar\n\n============================\n         INVOICE\n============================\n\nOrder ID  : ${order.id}\nTable No  : ${order.table_id}\nCustomer  : ${order.customer_name}\nTime      : ${time}\n\n----------------------------\n       ITEM DETAILS\n----------------------------\n\n${itemsList}\n\n----------------------------\n  TOTAL PAYABLE : Rs.${order.total}\n----------------------------\n\n  Thank you for dining with us!\n We look forward to serving you again.\n\n  Feedback & Enquiry:\n     +91-88301 46272\n\n============================\n    *50-50 CHINESE FAST FOOD*\n============================`;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, "_blank");
  };

  const pendingOrders = orders.filter(o => o.status !== "paid");
  const paidOrders    = orders.filter(o => o.status === "paid");
  const monthOpts     = getMonthOptions();

  // today's stats from daily
  const todayStr   = new Date().toISOString().slice(0, 10);
  const todayStats = daily.find(d => d.date === todayStr) || { total_orders: 0, total_income: 0, avg_order_value: 0 };
  const thisMonth  = monthly[0] || { total_orders: 0, total_income: 0, avg_order_value: 0, month_label: "" };

  if (!token) return null;

  return (
    <div style={S.page}>
      <style>{css}</style>

      {/* ── TAB BAR ── */}
      <div style={S.tabBar}>
        <button
          style={{ ...S.tabBtn, ...(tab === "orders" ? S.tabActive : {}) }}
          onClick={() => setTab("orders")}
        >
          📋 Orders
        </button>
        <button
          style={{ ...S.tabBtn, ...(tab === "stats" ? S.tabActive : {}) }}
          onClick={() => setTab("stats")}
        >
          📊 Stats & Reports
        </button>
        <button style={S.logoutBtn} onClick={handleLogout}>Logout</button>
      </div>

      <div className="wrap" style={S.wrap}>

        {/* ══════════════ ORDERS TAB ══════════════ */}
        {tab === "orders" && (
          loading ? <div style={S.loader}>Loading dashboard...</div> : (
            <>
              {/* KPI */}
              <div className="kpi-grid" style={S.kpiGrid}>
                {[
                  { label: "Total Income", value: `₹ ${income}`,       color: "#1C1C1C" },
                  { label: "Total Orders", value: orders.length,        color: "#1C1C1C" },
                  { label: "Pending",      value: pendingOrders.length, color: "#D32F2F" },
                  { label: "Completed",    value: paidOrders.length,    color: "#388E3C" },
                ].map(k => (
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
                  {tables.map(t => (
                    <div key={t.id} style={{ ...S.tblCard, background: t.status === "free" ? "#F1F8F1" : "#FFF3E0", borderColor: t.status === "free" ? "#388E3C" : "#F57C00" }}>
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
                  <span style={{ ...S.badge, background: "#D32F2F", color: "#FFF" }}>{pendingOrders.length}</span>
                </div>
                {pendingOrders.length === 0 ? (
                  <div style={S.empty}>No pending orders 🎉</div>
                ) : (
                  pendingOrders.map(o => {
                    const iStatus  = itemStatus[o.id] || {};
                    const allReady = (o.items || []).every((_, i) => iStatus[i] === "ready");
                    return (
                      <div key={o.id} className="order-card" style={S.orderCard}>
                        <div style={S.orderLeft}>
                          <div style={S.orderTopRow}>
                            <span style={S.orderId}>Order #{o.id}</span>
                            <span style={S.chip}>Table {o.table_id}</span>
                            <span style={{ ...S.chip, background: o.status === "ready" ? "#E8F5E9" : "#FFF3E0", color: o.status === "ready" ? "#388E3C" : "#F57C00" }}>
                              {o.status.toUpperCase()}
                            </span>
                          </div>
                          <div style={S.meta}>
                            <span style={S.metaName}>{o.customer_name}</span>
                            <span style={S.metaPhone}>{o.whatsapp}</span>
                          </div>
                          <div style={S.itemsBox}>
                            <div style={S.itemsHeader}>
                              <span style={S.itemsLabel}>ITEMS</span>
                              <span style={{ fontSize: "10px", color: "#9C9C9C" }}>tap to toggle</span>
                            </div>
                            {o.items?.map((item, i) => {
                              const ready = iStatus[i] === "ready";
                              return (
                                <div key={i} style={{ ...S.itemRow, background: ready ? "#F1F8F1" : "#FFF8F0", borderColor: ready ? "#388E3C" : "#F57C00", cursor: "pointer" }}
                                  onClick={() => toggleItem(o.id, i)}>
                                  <span style={S.itemQty}>{item.quantity}x</span>
                                  <span style={S.itemName}>{item.name}</span>
                                  <span style={S.itemPrice}>₹{item.price * item.quantity}</span>
                                  <span style={{ fontSize: "10px", fontWeight: "700", padding: "2px 7px", borderRadius: "20px", background: ready ? "#388E3C" : "#F57C00", color: "#FFF", whiteSpace: "nowrap", flexShrink: 0 }}>
                                    {ready ? "READY" : "PENDING"}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                        <div className="order-right" style={S.orderRight}>
                          <span style={S.total}>₹ {o.total}</span>
                          <div className="btns" style={S.btns}>
                            {allReady
                              ? <button style={S.btnOrange} onClick={() => updateStatus(o.id, "pending")}>Mark Pending</button>
                              : <button style={S.btnGreen}  onClick={() => updateStatus(o.id, "ready")}>Mark Ready</button>
                            }
                            <button style={S.btnWA}   onClick={() => sendWhatsApp(o)}>Send Bill</button>
                            <button style={S.btnGrey} onClick={() => markPaid(o.id)}>Paid ✓</button>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* COMPLETED ORDERS */}
              <div style={S.section}>
                <div style={S.secHead}>
                  <span style={S.secTitle}>Completed Orders</span>
                  <span style={{ ...S.badge, background: "#388E3C", color: "#FFF" }}>{paidOrders.length}</span>
                </div>
                {paidOrders.length === 0 ? (
                  <div style={S.empty}>No completed orders</div>
                ) : (
                  paidOrders.map(o => (
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
          )
        )}

        {/* ══════════════ STATS TAB ══════════════ */}
        {tab === "stats" && (
          statsLoading ? <div style={S.loader}>Loading stats...</div> : (
            <>
              {/* ── TODAY + THIS MONTH SUMMARY ── */}
              <div className="kpi-grid" style={S.kpiGrid}>
                {[
                  { label: "Today's Income",    value: `₹ ${todayStats.total_income}`,    color: "#1C1C1C" },
                  { label: "Today's Orders",    value: todayStats.total_orders,            color: "#1C1C1C" },
                  { label: "This Month Income", value: `₹ ${thisMonth.total_income}`,      color: "#1565C0" },
                  { label: "This Month Orders", value: thisMonth.total_orders,             color: "#1565C0" },
                ].map(k => (
                  <div key={k.label} className="kpi-card" style={S.kpiCard}>
                    <div style={S.kpiLabel}>{k.label}</div>
                    <div style={{ ...S.kpiValue, color: k.color }}>{k.value}</div>
                  </div>
                ))}
              </div>

              {/* ── CSV DOWNLOAD ── */}
              <div style={S.section}>
                <div style={S.secHead}>
                  <span style={S.secTitle}>📥 Download Monthly Report</span>
                </div>
                <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
                  <select
                    value={csvMonth}
                    onChange={e => setCsvMonth(e.target.value)}
                    style={S.select}
                  >
                    {monthOpts.map(m => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                  <button
                    style={{ ...S.btnGreen, padding: "10px 20px", fontSize: "13px" }}
                    onClick={downloadCSV}
                    disabled={csvLoading}
                  >
                    {csvLoading ? "Downloading..." : "⬇ Download CSV"}
                  </button>
                </div>
                <p style={{ fontSize: "12px", color: "#9C9C9C", marginTop: "10px" }}>
                  CSV includes: Order ID, Date, Time, Table, Customer, Items, Total
                </p>
              </div>

              {/* ── DAILY STATS TABLE (last 30 days) ── */}
              <div style={S.section}>
                <div style={S.secHead}>
                  <span style={S.secTitle}>📅 Daily Breakdown (Last 30 Days)</span>
                  <button style={{ ...S.btnGreen, padding: "5px 12px", fontSize: "11px" }} onClick={fetchStats}>
                    Refresh
                  </button>
                </div>
                {daily.length === 0 ? (
                  <div style={S.empty}>No data yet</div>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table style={S.table}>
                      <thead>
                        <tr>
                          {["Date", "Orders", "Income (₹)", "Avg Order (₹)"].map(h => (
                            <th key={h} style={S.th}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {daily.map((d, i) => (
                          <tr key={d.date} style={{ background: i % 2 === 0 ? "#FAFAFA" : "#FFF" }}>
                            <td style={S.td}>{d.date}</td>
                            <td style={{ ...S.td, textAlign: "center" }}>{d.total_orders}</td>
                            <td style={{ ...S.td, textAlign: "right", fontWeight: "600" }}>₹ {d.total_income}</td>
                            <td style={{ ...S.td, textAlign: "right" }}>₹ {d.avg_order_value}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr style={{ background: "#F0F0F0", fontWeight: "700" }}>
                          <td style={S.td}>Total</td>
                          <td style={{ ...S.td, textAlign: "center" }}>
                            {daily.reduce((s, d) => s + d.total_orders, 0)}
                          </td>
                          <td style={{ ...S.td, textAlign: "right" }}>
                            ₹ {daily.reduce((s, d) => s + d.total_income, 0).toFixed(2)}
                          </td>
                          <td style={S.td}></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>

              {/* ── MONTHLY STATS TABLE ── */}
              <div style={S.section}>
                <div style={S.secHead}>
                  <span style={S.secTitle}>📆 Monthly Summary (Last 12 Months)</span>
                </div>
                {monthly.length === 0 ? (
                  <div style={S.empty}>No data yet</div>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table style={S.table}>
                      <thead>
                        <tr>
                          {["Month", "Orders", "Income (₹)", "Avg Order (₹)", "Best Day"].map(h => (
                            <th key={h} style={S.th}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {monthly.map((m, i) => (
                          <tr key={`${m.year}-${m.month}`} style={{ background: i % 2 === 0 ? "#FAFAFA" : "#FFF" }}>
                            <td style={{ ...S.td, fontWeight: "600" }}>{m.month_label}</td>
                            <td style={{ ...S.td, textAlign: "center" }}>{m.total_orders}</td>
                            <td style={{ ...S.td, textAlign: "right", fontWeight: "600", color: "#1565C0" }}>
                              ₹ {m.total_income}
                            </td>
                            <td style={{ ...S.td, textAlign: "right" }}>₹ {m.avg_order_value}</td>
                            <td style={{ ...S.td, textAlign: "center", color: "#9C9C9C" }}>
                              {m.best_day?.trim() || "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )
        )}
      </div>
    </div>
  );
}

const S = {
  page:      { background: "#F4F4F4", minHeight: "100vh", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif" },
  tabBar:    { background: "#FFF", borderBottom: "1px solid #E8E8E8", padding: "0 16px", display: "flex", alignItems: "center", gap: "4px", position: "sticky", top: 0, zIndex: 99, boxShadow: "0 1px 3px rgba(0,0,0,0.06)" },
  tabBtn:    { background: "transparent", border: "none", padding: "14px 18px", cursor: "pointer", fontSize: "13px", fontWeight: "500", color: "#636363", borderBottom: "3px solid transparent", marginBottom: "-1px" },
  tabActive: { color: "#1565C0", borderBottomColor: "#1565C0", fontWeight: "700" },
  logoutBtn: { background: "#EF4F5F", color: "#FFF", border: "none", padding: "7px 16px", borderRadius: "4px", cursor: "pointer", fontSize: "12px", fontWeight: "500", marginLeft: "auto" },
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

  orderCard:   { display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "14px", background: "#FAFAFA", borderRadius: "6px", border: "1px solid #ECECEC", marginBottom: "10px", gap: "12px", flexWrap: "wrap" },
  orderLeft:   { flex: "1 1 220px" },
  orderRight:  { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "10px", flex: "0 0 auto" },
  orderTopRow: { display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap", marginBottom: "6px" },
  orderId:     { fontSize: "13px", fontWeight: "700", color: "#1C1C1C" },
  chip:        { background: "#ECECEC", color: "#555", padding: "2px 8px", borderRadius: "4px", fontSize: "11px", fontWeight: "500" },
  meta:        { display: "flex", gap: "10px", marginBottom: "10px", flexWrap: "wrap" },
  metaName:    { fontSize: "12px", color: "#555", fontWeight: "500" },
  metaPhone:   { fontSize: "12px", color: "#9C9C9C" },
  itemsBox:    { borderTop: "1px solid #E8E8E8", paddingTop: "8px" },
  itemsHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" },
  itemsLabel:  { fontSize: "10px", fontWeight: "700", color: "#555", textTransform: "uppercase", letterSpacing: "0.4px" },
  itemRow:     { display: "flex", gap: "8px", alignItems: "center", fontSize: "12px", marginBottom: "5px", padding: "6px 8px", borderRadius: "4px", border: "1px solid" },
  itemQty:     { background: "#ECECEC", color: "#555", padding: "1px 5px", borderRadius: "3px", fontWeight: "600", minWidth: "26px", textAlign: "center", flexShrink: 0 },
  itemName:    { flex: 1, color: "#636363" },
  itemPrice:   { fontWeight: "600", color: "#1C1C1C", flexShrink: 0 },
  total:       { fontSize: "20px", fontWeight: "700", color: "#1C1C1C" },
  btns:        { display: "flex", gap: "6px", flexWrap: "wrap", justifyContent: "flex-end" },
  btnGreen:    { background: "#388E3C", color: "#FFF", border: "none", padding: "7px 14px", borderRadius: "4px", cursor: "pointer", fontSize: "12px", fontWeight: "600", minHeight: "34px" },
  btnWA:       { background: "#25D366", color: "#FFF", border: "none", padding: "7px 14px", borderRadius: "4px", cursor: "pointer", fontSize: "12px", fontWeight: "600", minHeight: "34px" },
  btnOrange:   { background: "#F57C00", color: "#FFF", border: "none", padding: "7px 14px", borderRadius: "4px", cursor: "pointer", fontSize: "12px", fontWeight: "600", minHeight: "34px" },
  btnGrey:     { background: "#546E7A", color: "#FFF", border: "none", padding: "7px 14px", borderRadius: "4px", cursor: "pointer", fontSize: "12px", fontWeight: "600", minHeight: "34px" },

  // stats
  select: { padding: "9px 12px", borderRadius: "4px", border: "1px solid #E8E8E8", fontSize: "13px", background: "#FFF", cursor: "pointer", minWidth: "180px" },
  table:  { width: "100%", borderCollapse: "collapse", fontSize: "13px" },
  th:     { background: "#F5F5F5", padding: "10px 14px", textAlign: "left", fontWeight: "700", color: "#555", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.4px", borderBottom: "2px solid #E8E8E8", whiteSpace: "nowrap" },
  td:     { padding: "10px 14px", borderBottom: "1px solid #F0F0F0", color: "#1C1C1C" },
};

const css = `
  * { box-sizing: border-box; }

  @media (min-width: 1024px) {
    .kpi-grid   { grid-template-columns: repeat(4, 1fr) !important; }
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
