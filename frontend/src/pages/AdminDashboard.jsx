import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";

const API           = "https://five0-50-chinese-fast-food-6.onrender.com";
const POLL_INTERVAL = 5000;

const STATUS = {
  pending: { label: "Preparing",  bg: "rgba(251,146,60,0.12)", color: "#F97316", border: "rgba(249,115,22,0.3)" },
  ready:   { label: "Ready",      bg: "rgba(16,185,129,0.12)", color: "#059669", border: "rgba(5,150,105,0.3)" },
  paid:    { label: "Paid",       bg: "rgba(139,92,246,0.12)", color: "#7C3AED", border: "rgba(124,58,237,0.3)" },
};

function StatusChip({ status }) {
  const s = STATUS[status] || STATUS.pending;
  return (
    <span style={{
      background:    s.bg,
      color:         s.color,
      border:        `1px solid ${s.border}`,
      padding:       "3px 12px",
      borderRadius:  "20px",
      fontSize:      "10px",
      fontWeight:    "700",
      letterSpacing: "0.8px",
      textTransform: "uppercase",
      whiteSpace:    "nowrap",
    }}>
      {s.label}
    </span>
  );
}

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

function getMonthOptions() {
  const opts = [];
  const now  = new Date();
  for (let i = 0; i < 12; i++) {
    const d     = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleString("default", { month: "long", year: "numeric" });
    opts.push({ value, label });
  }
  return opts;
}

async function registerSW(token, knownIds) {
  if (!("serviceWorker" in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    const sw = reg.active || reg.waiting || reg.installing;
    if (sw) sw.postMessage({ type: "INIT", token, knownIds: [...knownIds] });
  } catch (e) {
    console.error("[SW] Registration failed:", e);
  }
}

export default function AdminDashboard() {
  const navigate = useNavigate();
  const token    = localStorage.getItem("adminToken");

  useEffect(() => {
    if (!token) navigate("/admin-login", { replace: true });
  }, []);

  const [tab,        setTab]        = useState("orders");
  const [tables,     setTables]     = useState([]);
  const [orders,     setOrders]     = useState([]);
  const [income,     setIncome]     = useState(0);
  const [loading,    setLoading]    = useState(true);

  const [itemStatus, setItemStatus] = useState(() => {
    try { return JSON.parse(localStorage.getItem("itemStatus") || "{}"); } catch { return {}; }
  });

  const [daily,        setDaily]        = useState([]);
  const [monthly,      setMonthly]      = useState([]);
  const [statsLoading, setStatsLoading] = useState(false);
  const [csvMonth,     setCsvMonth]     = useState(getMonthOptions()[0].value);
  const [csvLoading,   setCsvLoading]   = useState(false);
  const [updating,     setUpdating]     = useState({});

  const prevPendingIds = useRef(null);
  const pollingRef     = useRef(null);
  const heartbeatRef   = useRef(null);

  useEffect(() => {
    localStorage.setItem("itemStatus", JSON.stringify(itemStatus));
  }, [itemStatus]);

  const handleLogout = () => {
    clearInterval(pollingRef.current);
    clearInterval(heartbeatRef.current);
    navigator.serviceWorker?.controller?.postMessage({ type: "STOP" });
    localStorage.removeItem("adminToken");
    navigate("/admin-login", { replace: true });
  };

  const authH = () => ({ Authorization: "Bearer " + token });

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

      const currentIds = new Set(oData.filter(o => o.status !== "paid").map(o => o.id));

      if (isBackground && prevPendingIds.current !== null) {
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
      } else {
        setItemStatus(prev => {
          const next = { ...prev };
          oData.filter(o => o.status !== "paid" && !prev[o.id]).forEach(o => {
            next[o.id] = Object.fromEntries((o.items || []).map((_, i) => [i, "pending"]));
          });
          return next;
        });
      }

      prevPendingIds.current = currentIds;
      navigator.serviceWorker?.controller?.postMessage({ type: "UPDATE_IDS", knownIds: [...currentIds] });

      setTables(tData);
      setOrders(oData.map(o => ({ ...o, id: o._id })));
      setIncome(iData.total_income ?? 0);
    } catch (e) {
      console.error("fetchAll:", e);
    } finally {
      if (!isBackground) setLoading(false);
    }
  }, [token]);

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
    const initNotifications = async () => {
      if (!("Notification" in window)) return;
      let perm = Notification.permission;
      if (perm === "default") perm = await Notification.requestPermission();
      if (perm === "granted") await registerSW(token, prevPendingIds.current || new Set());
    };

    fetchAll(false);
    initNotifications();
    pollingRef.current   = setInterval(() => fetchAll(true), POLL_INTERVAL);
    heartbeatRef.current = setInterval(() => {
      navigator.serviceWorker?.controller?.postMessage({ type: "HEARTBEAT" });
    }, 10000);

    const onSWMessage = (event) => {
      const { type } = event.data || {};
      if (type === "PING" || type === "NEW_ORDER") fetchAll(true);
      if (type === "PING" && event.data?.logout)   handleLogout();
    };
    navigator.serviceWorker?.addEventListener("message", onSWMessage);

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        clearInterval(pollingRef.current);
        fetchAll(false);
        pollingRef.current = setInterval(() => fetchAll(true), POLL_INTERVAL);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    const onFocus = () => fetchAll(false);
    window.addEventListener("focus", onFocus);

    return () => {
      clearInterval(pollingRef.current);
      clearInterval(heartbeatRef.current);
      navigator.serviceWorker?.removeEventListener("message", onSWMessage);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  useEffect(() => {
    if (tab === "stats" && daily.length === 0) fetchStats();
  }, [tab]);

  const downloadCSV = async () => {
    setCsvLoading(true);
    try {
      const res = await fetch(`${API}/stats/monthly/csv?month=${csvMonth}`, { headers: authH() });
      if (!res.ok) throw new Error("Failed");
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `orders_${csvMonth}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("Failed to download CSV. Try again.");
    } finally {
      setCsvLoading(false);
    }
  };

  const toggleItem = (orderId, itemIdx) => {
    setItemStatus(prev => ({
      ...prev,
      [orderId]: {
        ...prev[orderId],
        [itemIdx]: prev[orderId]?.[itemIdx] === "ready" ? "pending" : "ready",
      },
    }));
  };

  const advanceStatus = async (order) => {
    if (updating[order.id]) return;
    const next = order.status === "pending" ? "ready" : null;
    if (!next) return;
    setUpdating(p => ({ ...p, [order.id]: true }));
    try {
      await fetch(`${API}/orders/${order.id}`, {
        method:  "PUT",
        headers: { "Content-Type": "application/json", ...authH() },
        body:    JSON.stringify({ status: next }),
      });
      if (next === "ready") {
        setItemStatus(prev => ({
          ...prev,
          [order.id]: Object.fromEntries((order.items || []).map((_, i) => [i, "ready"])),
        }));
      }
      await fetchAll(false);
    } catch (e) { console.error("advanceStatus:", e); }
    finally { setUpdating(p => ({ ...p, [order.id]: false })); }
  };

  const revertStatus = async (order) => {
    if (updating[order.id]) return;
    setUpdating(p => ({ ...p, [order.id]: true }));
    try {
      await fetch(`${API}/orders/${order.id}`, {
        method:  "PUT",
        headers: { "Content-Type": "application/json", ...authH() },
        body:    JSON.stringify({ status: "pending" }),
      });
      setItemStatus(prev => ({
        ...prev,
        [order.id]: Object.fromEntries((order.items || []).map((_, i) => [i, "pending"])),
      }));
      await fetchAll(false);
    } catch (e) { console.error("revertStatus:", e); }
    finally { setUpdating(p => ({ ...p, [order.id]: false })); }
  };

  const markPaid = async (orderId) => {
    if (updating[orderId]) return;
    setUpdating(p => ({ ...p, [orderId]: true }));
    try {
      await fetch(`${API}/orders/${orderId}/pay`, { method: "PUT", headers: authH() });
      setItemStatus(prev => { const n = { ...prev }; delete n[orderId]; return n; });
      await fetchAll(false);
      if (tab === "stats") fetchStats();
    } catch (e) { console.error("markPaid:", e); }
    finally { setUpdating(p => ({ ...p, [orderId]: false })); }
  };

  const sendWhatsApp = (order) => {
    let phone      = order.whatsapp.replace(/\D/g, "");
    if (phone.length === 10) phone = "91" + phone;
    const shortId  = order.id.slice(-6).toUpperCase();
    const tableNum = tableMap[order.table_id] || order.table_id;
    const itemsList = (order.items || []).map((item, i) =>
      `${i + 1}. ${item.name}\n   Qty: ${item.quantity} × ₹${item.price}\n   Amount: ₹${item.price * item.quantity}`
    ).join("\n\n");
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const msg = `*50-50 CHINESE FAST FOOD*\nCIDCO, Chhatrapati Sambhajinagar\n\n============================\n         INVOICE\n============================\n\nOrder ID  : #${shortId}\nTable No  : ${tableNum}\nCustomer  : ${order.customer_name}\nTime      : ${time}\n\n----------------------------\n       ITEM DETAILS\n----------------------------\n\n${itemsList}\n\n----------------------------\n  TOTAL PAYABLE : Rs.${order.total}\n----------------------------\n\n  Thank you for dining with us!\n We look forward to serving you again.\n\n  Feedback & Enquiry:\n     +91-88301 46272\n\n============================\n    *50-50 CHINESE FAST FOOD*\n============================`;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, "_blank");
  };

  // ── Derived ───────────────────────────────────────────────
  const tableMap      = Object.fromEntries(tables.map(t => [t.id, t.number]));
  const pendingOrders = orders.filter(o => o.status === "pending");
  const readyOrders   = orders.filter(o => o.status === "ready");
  const paidOrders    = orders.filter(o => o.status === "paid");
  const monthOpts     = getMonthOptions();
  const todayStr      = new Date().toISOString().slice(0, 10);
  const todayStats    = daily.find(d => d.date === todayStr) || { total_orders: 0, total_income: 0 };
  const thisMonth     = monthly[0] || { total_orders: 0, total_income: 0, month_label: "" };

  if (!token) return null;

  // ── ORDER CARD ────────────────────────────────────────────
  const OrderCard = ({ o }) => {
    const iStatus    = itemStatus[o.id] || {};
    const isUpdating = !!updating[o.id];
    const shortId    = o.id.slice(-6).toUpperCase();
    const tableNum   = tableMap[o.table_id] || o.table_id;

    const accentColor = o.status === "ready"
      ? "rgba(5,150,105,0.5)"
      : "rgba(249,115,22,0.5)";

    return (
      <div className="order-card" style={{
        background:   "linear-gradient(135deg, #16131f 0%, #0f0d18 100%)",
        border:       `1px solid ${accentColor.replace("0.5","0.2")}`,
        borderLeft:   `3px solid ${accentColor.replace("0.5","0.85")}`,
        borderRadius: "12px",
        padding:      "18px 20px",
        marginBottom: "12px",
        display:      "flex",
        justifyContent: "space-between",
        alignItems:   "flex-start",
        gap:          "16px",
        flexWrap:     "wrap",
        boxShadow:    "0 4px 24px rgba(0,0,0,0.35)",
      }}>
        {/* LEFT */}
        <div style={{ flex: "1 1 240px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginBottom: "8px" }}>
            <span style={{
              fontFamily: "'Playfair Display', serif",
              fontSize: "15px", fontWeight: "700", color: "#E8D5A3",
            }}>
              #{shortId}
            </span>
            <span style={{
              background: "rgba(201,168,76,0.12)", color: "#C9A84C",
              border: "1px solid rgba(201,168,76,0.25)",
              padding: "2px 10px", borderRadius: "4px",
              fontSize: "11px", fontWeight: "600", letterSpacing: "0.5px",
            }}>
              {tableNum}
            </span>
            <StatusChip status={o.status} />
          </div>

          <div style={{ display: "flex", gap: "16px", marginBottom: "14px", flexWrap: "wrap" }}>
            <span style={{ fontSize: "12px", color: "#94A3B8" }}>👤 {o.customer_name}</span>
            {o.whatsapp && <span style={{ fontSize: "12px", color: "#475569" }}>📞 {o.whatsapp}</span>}
          </div>

          <div style={{ borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: "12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
              <span style={{ fontSize: "9px", fontWeight: "700", color: "#334155", letterSpacing: "1.2px", textTransform: "uppercase" }}>
                Order Items
              </span>
              <span style={{ fontSize: "9px", color: "#1E293B", letterSpacing: "0.5px" }}>tap item to toggle</span>
            </div>
            {(o.items || []).map((item, i) => {
              const ready = iStatus[i] === "ready";
              return (
                <div key={i} onClick={() => toggleItem(o.id, i)} style={{
                  display:      "flex",
                  alignItems:   "center",
                  gap:          "10px",
                  padding:      "8px 12px",
                  borderRadius: "8px",
                  marginBottom: "6px",
                  cursor:       "pointer",
                  background:   ready ? "rgba(5,150,105,0.09)" : "rgba(249,115,22,0.07)",
                  border:       `1px solid ${ready ? "rgba(5,150,105,0.2)" : "rgba(249,115,22,0.14)"}`,
                  transition:   "all 0.15s ease",
                }}>
                  <span style={{
                    background: ready ? "rgba(5,150,105,0.2)" : "rgba(249,115,22,0.18)",
                    color:      ready ? "#34D399" : "#FB923C",
                    padding: "1px 8px", borderRadius: "4px",
                    fontSize: "11px", fontWeight: "700", flexShrink: 0,
                  }}>
                    {item.quantity}×
                  </span>
                  <span style={{ flex: 1, fontSize: "12px", color: "#94A3B8" }}>{item.name}</span>
                  <span style={{ fontSize: "12px", fontWeight: "600", color: "#E8D5A3", flexShrink: 0 }}>
                    ₹{item.price * item.quantity}
                  </span>
                  <span style={{
                    fontSize: "9px", fontWeight: "700",
                    padding: "2px 8px", borderRadius: "20px", letterSpacing: "0.6px", flexShrink: 0,
                    background: ready ? "rgba(5,150,105,0.22)" : "rgba(249,115,22,0.18)",
                    color:      ready ? "#34D399" : "#FB923C",
                  }}>
                    {ready ? "READY" : "PENDING"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* RIGHT */}
        <div className="order-right" style={{
          display: "flex", flexDirection: "column",
          alignItems: "flex-end", gap: "12px", flex: "0 0 auto",
        }}>
          <div style={{
            fontFamily: "'Playfair Display', serif",
            fontSize: "26px", fontWeight: "700", color: "#E8D5A3",
          }}>
            ₹ {o.total}
          </div>
          <div className="btns" style={{ display: "flex", gap: "8px", flexWrap: "wrap", justifyContent: "flex-end" }}>
            {o.status === "pending" && (
              <button className="btn-action btn-green" disabled={isUpdating} onClick={() => advanceStatus(o)}>
                {isUpdating ? "•••" : "✓ Mark Ready"}
              </button>
            )}
            {o.status === "ready" && (
              <button className="btn-action btn-orange" disabled={isUpdating} onClick={() => revertStatus(o)}>
                {isUpdating ? "•••" : "↩ Preparing"}
              </button>
            )}
            <button className="btn-action btn-wa" onClick={() => sendWhatsApp(o)}>
              💬 Send Bill
            </button>
            {o.status === "ready" && (
              <button className="btn-action btn-paid" disabled={isUpdating} onClick={() => markPaid(o.id)}>
                {isUpdating ? "•••" : "💰 Mark Paid"}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ── SECTION ───────────────────────────────────────────────
  const Section = ({ title, badge, badgeStyle, children, rightSlot }) => (
    <div style={{
      background:   "linear-gradient(135deg, #16131f 0%, #11101a 100%)",
      border:       "1px solid rgba(255,255,255,0.055)",
      borderRadius: "14px",
      padding:      "22px",
      marginBottom: "16px",
      boxShadow:    "0 6px 28px rgba(0,0,0,0.3)",
    }}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        marginBottom: "18px", paddingBottom: "14px",
        borderBottom: "1px solid rgba(255,255,255,0.05)",
      }}>
        <span style={{
          fontFamily: "'Playfair Display', serif",
          fontSize: "15px", fontWeight: "700", color: "#E8D5A3", letterSpacing: "0.2px",
        }}>
          {title}
        </span>
        {badge !== undefined && (
          <span style={{
            background: "rgba(201,168,76,0.12)",
            color: "#C9A84C",
            border: "1px solid rgba(201,168,76,0.22)",
            padding: "3px 14px", borderRadius: "20px",
            fontSize: "12px", fontWeight: "700",
            ...badgeStyle,
          }}>
            {badge}
          </span>
        )}
        {rightSlot}
      </div>
      {children}
    </div>
  );

  const Empty = ({ msg }) => (
    <div style={{ padding: "32px", textAlign: "center", color: "#1E293B", fontSize: "13px", letterSpacing: "0.3px" }}>
      {msg}
    </div>
  );

  const thStyle = {
    padding: "10px 16px", textAlign: "left",
    fontSize: "9px", fontWeight: "700", color: "#334155",
    letterSpacing: "1.2px", textTransform: "uppercase",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
    background: "rgba(255,255,255,0.02)", whiteSpace: "nowrap",
  };

  const tdStyle = (extra = {}) => ({
    padding: "11px 16px",
    borderBottom: "1px solid rgba(255,255,255,0.04)",
    color: "#94A3B8",
    ...extra,
  });

  return (
    <div style={{ background: "#0C0A14", minHeight: "100vh", fontFamily: "'DM Sans', sans-serif" }}>
      <style>{css}</style>

      {/* ── HEADER ── */}
      <header style={{
        background:   "linear-gradient(180deg, #12101b 0%, #0c0a14 100%)",
        borderBottom: "1px solid rgba(201,168,76,0.12)",
        padding:      "0 24px",
        display:      "flex",
        alignItems:   "center",
        gap:          "4px",
        position:     "sticky",
        top:          0,
        zIndex:       99,
        boxShadow:    "0 4px 30px rgba(0,0,0,0.5)",
      }}>
        {/* Brand */}
        <div style={{
          padding: "14px 24px 14px 0",
          marginRight: "16px",
          borderRight: "1px solid rgba(201,168,76,0.12)",
        }}>
          <div style={{
            fontFamily: "'Playfair Display', serif",
            fontSize: "17px", fontWeight: "700",
            background: "linear-gradient(135deg, #C9A84C 0%, #E8D5A3 60%, #C9A84C 100%)",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
            letterSpacing: "1px",
          }}>
            50·50
          </div>
          <div style={{ fontSize: "8px", color: "#334155", letterSpacing: "2.5px", textTransform: "uppercase", marginTop: "1px" }}>
            Operations
          </div>
        </div>

        {/* Tabs */}
        <button className={`tab-btn ${tab === "orders" ? "tab-active" : ""}`} onClick={() => setTab("orders")}>
          Orders
        </button>
        <button className={`tab-btn ${tab === "stats" ? "tab-active" : ""}`} onClick={() => setTab("stats")}>
          Analytics
        </button>

        {/* Right side */}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "18px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
            <span className="pulse-dot" />
            <span style={{ fontSize: "10px", color: "#334155", letterSpacing: "1px", textTransform: "uppercase" }}>Live</span>
          </div>
          <button className="btn-logout" onClick={handleLogout}>Sign Out</button>
        </div>
      </header>

      {/* ── BODY ── */}
      <div className="wrap">

        {/* ══ ORDERS TAB ══ */}
        {tab === "orders" && (
          loading
            ? <div style={{ textAlign: "center", padding: "100px", color: "#334155", fontSize: "13px", letterSpacing: "1.5px", textTransform: "uppercase" }}>
                Loading dashboard…
              </div>
            : (
              <>
                {/* KPIs */}
                <div className="kpi-grid">
                  {[
                    { label: "Total Revenue",  value: `₹ ${income}`,       accent: "#C9A84C", icon: "💰" },
                    { label: "Total Orders",   value: orders.length,        accent: "#818CF8", icon: "🧾" },
                    { label: "Preparing",      value: pendingOrders.length, accent: "#F97316", icon: "⏳" },
                    { label: "Ready",          value: readyOrders.length,   accent: "#059669", icon: "✅" },
                  ].map(k => (
                    <div key={k.label} className="kpi-card">
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div>
                          <div style={{ fontSize: "9px", fontWeight: "700", color: "#334155", letterSpacing: "1.3px", textTransform: "uppercase", marginBottom: "12px" }}>
                            {k.label}
                          </div>
                          <div style={{ fontFamily: "'Playfair Display', serif", fontSize: "32px", fontWeight: "700", color: k.accent }}>
                            {k.value}
                          </div>
                        </div>
                        <span style={{ fontSize: "26px", opacity: 0.3 }}>{k.icon}</span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Status Flow */}
                <div style={{
                  background: "rgba(201,168,76,0.04)",
                  border: "1px solid rgba(201,168,76,0.1)",
                  borderRadius: "10px", padding: "12px 20px",
                  marginBottom: "16px", display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap",
                }}>
                  <span style={{ fontSize: "9px", fontWeight: "700", color: "#475569", letterSpacing: "1.2px", textTransform: "uppercase" }}>
                    Workflow
                  </span>
                  <StatusChip status="pending" />
                  <span style={{ color: "#1E293B" }}>→</span>
                  <StatusChip status="ready" />
                  <span style={{ color: "#1E293B" }}>→</span>
                  <StatusChip status="paid" />
                  <span style={{ fontSize: "11px", color: "#1E293B", marginLeft: "4px" }}>
                    · Mark Ready notifies customer · Mark Paid frees the table
                  </span>
                </div>

                {/* Floor Plan */}
                <Section title="Floor Plan" badge={`${tables.length} tables`}>
                  <div className="tbl-grid">
                    {tables.map(t => (
                      <div key={t.id} style={{
                        padding: "16px 10px", borderRadius: "10px", textAlign: "center",
                        border: `1px solid ${t.status === "free" ? "rgba(5,150,105,0.25)" : "rgba(249,115,22,0.3)"}`,
                        background: t.status === "free" ? "rgba(5,150,105,0.07)" : "rgba(249,115,22,0.07)",
                        transition: "transform 0.2s ease",
                        cursor: "default",
                      }}
                      className="tbl-card"
                      >
                        <div style={{
                          fontFamily: "'Playfair Display', serif",
                          fontSize: "20px", fontWeight: "700",
                          color: t.status === "free" ? "#34D399" : "#FB923C",
                          marginBottom: "4px",
                        }}>
                          {t.number}
                        </div>
                        <div style={{
                          fontSize: "9px", fontWeight: "700", letterSpacing: "1px", textTransform: "uppercase",
                          color: t.status === "free" ? "#059669" : "#EA580C",
                        }}>
                          {t.status === "free" ? "Available" : "Occupied"}
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>

                {/* Preparing */}
                <Section
                  title="⏳ Preparing"
                  badge={pendingOrders.length}
                  badgeStyle={{ background: "rgba(249,115,22,0.12)", color: "#F97316", border: "1px solid rgba(249,115,22,0.25)" }}
                >
                  {pendingOrders.length === 0
                    ? <Empty msg="No orders currently being prepared" />
                    : pendingOrders.map(o => <OrderCard key={o.id} o={o} />)
                  }
                </Section>

                {/* Ready */}
                <Section
                  title="✓ Ready to Collect"
                  badge={readyOrders.length}
                  badgeStyle={{ background: "rgba(5,150,105,0.12)", color: "#059669", border: "1px solid rgba(5,150,105,0.25)" }}
                >
                  {readyOrders.length === 0
                    ? <Empty msg="No orders ready yet" />
                    : readyOrders.map(o => <OrderCard key={o.id} o={o} />)
                  }
                </Section>

                {/* Paid */}
                <Section
                  title="💰 Completed"
                  badge={paidOrders.length}
                  badgeStyle={{ background: "rgba(124,58,237,0.12)", color: "#7C3AED", border: "1px solid rgba(124,58,237,0.25)" }}
                >
                  {paidOrders.length === 0
                    ? <Empty msg="No completed orders" />
                    : paidOrders.map(o => {
                        const shortId  = o.id.slice(-6).toUpperCase();
                        const tableNum = tableMap[o.table_id] || o.table_id;
                        return (
                          <div key={o.id} style={{
                            display: "flex", justifyContent: "space-between", alignItems: "center",
                            padding: "14px 18px", borderRadius: "10px", marginBottom: "8px",
                            background: "rgba(124,58,237,0.05)",
                            border: "1px solid rgba(124,58,237,0.12)",
                            opacity: 0.72, gap: "12px", flexWrap: "wrap",
                          }}>
                            <div>
                              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "5px", flexWrap: "wrap" }}>
                                <span style={{ fontFamily: "'Playfair Display', serif", fontSize: "13px", fontWeight: "700", color: "#A78BFA" }}>
                                  #{shortId}
                                </span>
                                <span style={{
                                  background: "rgba(201,168,76,0.1)", color: "#C9A84C",
                                  border: "1px solid rgba(201,168,76,0.2)",
                                  padding: "1px 8px", borderRadius: "4px", fontSize: "10px", fontWeight: "600",
                                }}>
                                  {tableNum}
                                </span>
                                <StatusChip status="paid" />
                              </div>
                              <span style={{ fontSize: "12px", color: "#475569" }}>👤 {o.customer_name}</span>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                              <span style={{ fontFamily: "'Playfair Display', serif", fontSize: "20px", fontWeight: "700", color: "#A78BFA" }}>
                                ₹ {o.total}
                              </span>
                              <button className="btn-action btn-wa" onClick={() => sendWhatsApp(o)}>
                                💬 Send Bill
                              </button>
                            </div>
                          </div>
                        );
                      })
                  }
                </Section>
              </>
            )
        )}

        {/* ══ STATS TAB ══ */}
        {tab === "stats" && (
          statsLoading
            ? <div style={{ textAlign: "center", padding: "100px", color: "#334155", fontSize: "13px", letterSpacing: "1.5px", textTransform: "uppercase" }}>
                Loading analytics…
              </div>
            : (
              <>
                <div className="kpi-grid">
                  {[
                    { label: "Today's Revenue",  value: `₹ ${todayStats.total_income}`, accent: "#C9A84C", icon: "📈" },
                    { label: "Today's Orders",   value: todayStats.total_orders,         accent: "#818CF8", icon: "🧾" },
                    { label: "Monthly Revenue",  value: `₹ ${thisMonth.total_income}`,   accent: "#059669", icon: "💹" },
                    { label: "Monthly Orders",   value: thisMonth.total_orders,           accent: "#F97316", icon: "📦" },
                  ].map(k => (
                    <div key={k.label} className="kpi-card">
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div>
                          <div style={{ fontSize: "9px", fontWeight: "700", color: "#334155", letterSpacing: "1.3px", textTransform: "uppercase", marginBottom: "12px" }}>
                            {k.label}
                          </div>
                          <div style={{ fontFamily: "'Playfair Display', serif", fontSize: "32px", fontWeight: "700", color: k.accent }}>
                            {k.value}
                          </div>
                        </div>
                        <span style={{ fontSize: "26px", opacity: 0.3 }}>{k.icon}</span>
                      </div>
                    </div>
                  ))}
                </div>

                <Section title="📥 Monthly Report Export">
                  <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
                    <select
                      value={csvMonth}
                      onChange={e => setCsvMonth(e.target.value)}
                      style={{
                        padding: "10px 14px", borderRadius: "8px",
                        border: "1px solid rgba(201,168,76,0.2)",
                        background: "rgba(201,168,76,0.05)", color: "#E8D5A3",
                        fontSize: "13px", cursor: "pointer", minWidth: "200px",
                        fontFamily: "'DM Sans', sans-serif", outline: "none",
                      }}
                    >
                      {monthOpts.map(m => <option key={m.value} value={m.value} style={{ background: "#1a1625", color: "#E8D5A3" }}>{m.label}</option>)}
                    </select>
                    <button
                      className="btn-action btn-green"
                      style={{ padding: "10px 22px", fontSize: "13px", opacity: csvLoading ? 0.6 : 1 }}
                      onClick={downloadCSV}
                      disabled={csvLoading}
                    >
                      {csvLoading ? "Downloading…" : "⬇ Download CSV"}
                    </button>
                  </div>
                  <p style={{ fontSize: "11px", color: "#334155", marginTop: "10px", letterSpacing: "0.3px" }}>
                    Includes: Order ID · Date · Time · Table · Customer · Items · Total
                  </p>
                </Section>

                <Section
                  title="📅 Daily Breakdown — Last 30 Days"
                  rightSlot={
                    <button className="btn-action btn-green" style={{ padding: "6px 14px", fontSize: "11px" }} onClick={fetchStats}>
                      Refresh
                    </button>
                  }
                >
                  {daily.length === 0 ? <Empty msg="No data available" /> : (
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                        <thead>
                          <tr>
                            {["Date", "Orders", "Income (₹)", "Avg Order (₹)"].map(h => (
                              <th key={h} style={thStyle}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {daily.map((d, i) => (
                            <tr key={d.date} className="tbl-row" style={{ background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.012)" }}>
                              <td style={tdStyle()}>{d.date}</td>
                              <td style={tdStyle({ textAlign: "center", color: "#CBD5E1" })}>{d.total_orders}</td>
                              <td style={tdStyle({ textAlign: "right", fontWeight: "700", color: "#C9A84C", fontFamily: "'Playfair Display', serif" })}>₹ {d.total_income}</td>
                              <td style={tdStyle({ textAlign: "right", color: "#475569" })}>₹ {d.avg_order_value}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr style={{ background: "rgba(201,168,76,0.05)" }}>
                            <td style={{ ...tdStyle(), fontWeight: "700", color: "#E8D5A3", fontFamily: "'Playfair Display', serif" }}>Total</td>
                            <td style={{ ...tdStyle({ textAlign: "center" }), fontWeight: "700", color: "#E8D5A3" }}>{daily.reduce((s, d) => s + d.total_orders, 0)}</td>
                            <td style={{ ...tdStyle({ textAlign: "right" }), fontWeight: "700", color: "#C9A84C", fontFamily: "'Playfair Display', serif" }}>₹ {daily.reduce((s, d) => s + d.total_income, 0).toFixed(2)}</td>
                            <td style={tdStyle()} />
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </Section>

                <Section title="📆 Monthly Summary — Last 12 Months">
                  {monthly.length === 0 ? <Empty msg="No data available" /> : (
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                        <thead>
                          <tr>
                            {["Month", "Orders", "Income (₹)", "Avg Order (₹)", "Best Day"].map(h => (
                              <th key={h} style={thStyle}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {monthly.map((m, i) => (
                            <tr key={`${m.year}-${m.month}`} className="tbl-row" style={{ background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.012)" }}>
                              <td style={{ ...tdStyle(), fontWeight: "600", color: "#E8D5A3", fontFamily: "'Playfair Display', serif" }}>{m.month_label}</td>
                              <td style={tdStyle({ textAlign: "center", color: "#CBD5E1" })}>{m.total_orders}</td>
                              <td style={tdStyle({ textAlign: "right", fontWeight: "700", color: "#C9A84C", fontFamily: "'Playfair Display', serif" })}>₹ {m.total_income}</td>
                              <td style={tdStyle({ textAlign: "right", color: "#475569" })}>₹ {m.avg_order_value}</td>
                              <td style={tdStyle({ textAlign: "center", color: "#334155" })}>{m.best_day?.trim() || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Section>
              </>
            )
        )}
      </div>
    </div>
  );
}

/* ── GLOBAL CSS ── */
const css = `
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600;9..40,700&display=swap');

  * { box-sizing: border-box; margin: 0; padding: 0; }

  .wrap {
    max-width: 1400px;
    margin: 0 auto;
    padding: 24px 20px;
  }

  /* KPI */
  .kpi-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    gap: 14px;
    margin-bottom: 18px;
  }

  .kpi-card {
    background: linear-gradient(135deg, #16131f 0%, #11101a 100%);
    border: 1px solid rgba(255,255,255,0.055);
    border-radius: 14px;
    padding: 24px;
    box-shadow: 0 6px 28px rgba(0,0,0,0.32);
    transition: transform 0.2s ease, box-shadow 0.2s ease;
  }

  .kpi-card:hover {
    transform: translateY(-3px);
    box-shadow: 0 14px 40px rgba(0,0,0,0.45);
  }

  /* Table grid */
  .tbl-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
    gap: 10px;
  }

  .tbl-card:hover { transform: scale(1.05); }

  /* Tabs */
  .tab-btn {
    background: transparent;
    border: none;
    padding: 16px 22px;
    cursor: pointer;
    font-family: 'DM Sans', sans-serif;
    font-size: 13px;
    font-weight: 500;
    color: #334155;
    letter-spacing: 0.4px;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    transition: color 0.2s ease;
  }

  .tab-btn:hover { color: #64748B; }

  .tab-active {
    color: #C9A84C !important;
    border-bottom-color: #C9A84C !important;
    font-weight: 700 !important;
  }

  /* Buttons */
  .btn-action {
    border: none;
    padding: 8px 16px;
    border-radius: 8px;
    cursor: pointer;
    font-family: 'DM Sans', sans-serif;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.2px;
    min-height: 36px;
    transition: filter 0.18s ease, transform 0.18s ease;
    white-space: nowrap;
  }

  .btn-action:hover  { filter: brightness(1.18); transform: translateY(-1px); }
  .btn-action:active { transform: translateY(0); filter: brightness(0.94); }
  .btn-action:disabled { cursor: not-allowed; opacity: 0.48; transform: none; filter: none; }

  .btn-green  { background: linear-gradient(135deg, #059669, #047857); color: #fff; }
  .btn-orange { background: linear-gradient(135deg, #EA580C, #C2410C); color: #fff; }
  .btn-wa     { background: linear-gradient(135deg, #16A34A, #15803D); color: #fff; }
  .btn-paid   { background: linear-gradient(135deg, #7C3AED, #6D28D9); color: #fff; }

  .btn-logout {
    background: rgba(239,68,68,0.1);
    color: #F87171;
    border: 1px solid rgba(239,68,68,0.2);
    padding: 7px 18px;
    border-radius: 8px;
    cursor: pointer;
    font-family: 'DM Sans', sans-serif;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.3px;
    transition: all 0.18s ease;
  }

  .btn-logout:hover {
    background: rgba(239,68,68,0.2);
    border-color: rgba(239,68,68,0.35);
  }

  /* Live pulse */
  .pulse-dot {
    display: inline-block;
    width: 7px; height: 7px;
    background: #22C55E;
    border-radius: 50%;
    animation: pulse-ring 1.8s ease-out infinite;
  }

  @keyframes pulse-ring {
    0%   { box-shadow: 0 0 0 0 rgba(34,197,94,0.55); }
    70%  { box-shadow: 0 0 0 7px rgba(34,197,94,0); }
    100% { box-shadow: 0 0 0 0 rgba(34,197,94,0); }
  }

  .order-card { transition: transform 0.18s ease, box-shadow 0.18s ease; }
  .order-card:hover { transform: translateY(-1px); box-shadow: 0 10px 40px rgba(0,0,0,0.48) !important; }

  .tbl-row { transition: background 0.14s ease; }
  .tbl-row:hover { background: rgba(201,168,76,0.04) !important; }

  /* Responsive */
  @media (min-width: 1024px) {
    .kpi-grid { grid-template-columns: repeat(4, 1fr) !important; }
  }

  @media (max-width: 768px) {
    .kpi-grid { grid-template-columns: repeat(2, 1fr) !important; }
    .wrap { padding: 14px 12px !important; }
    .tbl-grid { grid-template-columns: repeat(auto-fill, minmax(80px, 1fr)) !important; }
    .order-right {
      flex-direction: row !important;
      width: 100% !important;
      justify-content: space-between !important;
      align-items: center !important;
    }
  }

  @media (max-width: 480px) {
    .btns { width: 100% !important; }
    .btns .btn-action { flex: 1 !important; }
    .wrap { padding: 10px 8px !important; }
  }

  @media (hover: none) and (pointer: coarse) {
    .btn-action { min-height: 44px !important; -webkit-tap-highlight-color: transparent; }
    .btn-action:hover { transform: none; filter: none; }
    .kpi-card:hover { transform: none; }
    .order-card:hover { transform: none; }
  }
`;
