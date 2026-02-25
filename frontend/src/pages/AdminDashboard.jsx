import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";

const API = "https://five0-50-chinese-fast-food-6.onrender.com";
const POLL_MS = 6000;

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function getMonthOptions() {
  const opts = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    opts.push({
      value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: d.toLocaleString("default", { month: "long", year: "numeric" }),
    });
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

// ─────────────────────────────────────────────
// Toast component
// ─────────────────────────────────────────────
function Toast({ toasts, onDismiss }) {
  return (
    <div style={TS.container}>
      {toasts.map((t) => (
        <div
          key={t.id}
          style={{
            ...TS.toast,
            background: t.type === "error" ? "#FF3B3B"
              : t.type === "success" ? "#00C851"
              : t.type === "order" ? "#FF6B35"
              : "#1A1A2E",
          }}
          onClick={() => onDismiss(t.id)}
        >
          <span style={TS.icon}>{t.icon}</span>
          <div>
            <div style={TS.title}>{t.title}</div>
            {t.body && <div style={TS.body}>{t.body}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

const TS = {
  container: {
    position: "fixed", top: 16, right: 16, zIndex: 9999,
    display: "flex", flexDirection: "column", gap: 8,
    pointerEvents: "none",
  },
  toast: {
    display: "flex", alignItems: "flex-start", gap: 10,
    padding: "12px 16px", borderRadius: 12,
    boxShadow: "0 8px 32px rgba(0,0,0,0.35)",
    color: "#FFF", maxWidth: 320, minWidth: 240,
    animation: "slideIn 0.3s ease",
    pointerEvents: "auto", cursor: "pointer",
    backdropFilter: "blur(8px)",
  },
  icon: { fontSize: 20, flexShrink: 0, marginTop: 1 },
  title: { fontSize: 13, fontWeight: 700, lineHeight: 1.3 },
  body: { fontSize: 12, opacity: 0.85, marginTop: 2, lineHeight: 1.4 },
};

// ─────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────
function AdminDashboard() {
  const navigate = useNavigate();
  const token = localStorage.getItem("adminToken");

  useEffect(() => {
    if (!token) navigate("/admin-login", { replace: true });
  }, []);

  const [tab, setTab] = useState("orders");
  const [tables, setTables] = useState([]);
  const [orders, setOrders] = useState([]);
  const [income, setIncome] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [notifStatus, setNotifStatus] = useState(
    typeof Notification !== "undefined" ? Notification.permission : "default"
  );
  const [toasts, setToasts] = useState([]);
  const [newOrderBanner, setNewOrderBanner] = useState(null);

  const [itemStatus, setItemStatus] = useState(() => {
    try { return JSON.parse(localStorage.getItem("itemStatus") || "{}"); }
    catch { return {}; }
  });

  const [daily, setDaily] = useState([]);
  const [monthly, setMonthly] = useState([]);
  const [statsLoading, setStatsLoading] = useState(false);
  const [csvMonth, setCsvMonth] = useState(getMonthOptions()[0].value);
  const [csvLoading, setCsvLoading] = useState(false);

  const prevPendingIds = useRef(new Set());
  const pollingRef = useRef(null);
  const fetchingRef = useRef(false);
  const heartbeatRef = useRef(null);
  const toastIdRef = useRef(0);

  useEffect(() => {
    localStorage.setItem("itemStatus", JSON.stringify(itemStatus));
  }, [itemStatus]);

  // ── Toast system ──
  const addToast = useCallback((toast) => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev.slice(-4), { ...toast, id }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const authH = useCallback(() => ({
    Authorization: "Bearer " + token,
  }), [token]);

  const handleLogout = useCallback(() => {
    clearInterval(pollingRef.current);
    clearInterval(heartbeatRef.current);
    navigator.serviceWorker?.controller?.postMessage({ type: "STOP" });
    localStorage.removeItem("adminToken");
    navigate("/admin-login", { replace: true });
  }, [navigate, token]);

  // ── Notification + SW setup ──
  const setupNotifications = useCallback(async () => {
    if (!("Notification" in window)) {
      addToast({ icon: "⚠️", title: "Notifications not supported", type: "error" });
      return;
    }
    let perm = Notification.permission;
    if (perm === "default") {
      perm = await Notification.requestPermission();
      setNotifStatus(perm);
    }
    if (perm === "granted") {
      await registerSW(token, prevPendingIds.current);
      addToast({ icon: "🔔", title: "Notifications enabled!", type: "success" });
    } else {
      addToast({
        icon: "⚠️",
        title: "Notifications blocked",
        body: "Go to browser Site Settings → allow notifications",
        type: "error",
      });
    }
  }, [token, addToast]);

  // ── Core fetch ──
  const fetchAll = useCallback(async (isBackground = false) => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;

    try {
      const [tRes, oRes, iRes] = await Promise.all([
        fetch(`${API}/tables`, { cache: "no-store" }),
        fetch(`${API}/orders`, { headers: authH(), cache: "no-store" }),
        fetch(`${API}/income`, { headers: authH(), cache: "no-store" }),
      ]);

      if (oRes.status === 401 || iRes.status === 401) {
        addToast({ icon: "🔒", title: "Session expired. Logging out…", type: "error" });
        setTimeout(handleLogout, 1500);
        return;
      }

      if (!tRes.ok || !oRes.ok || !iRes.ok) {
        throw new Error(`Server error (${oRes.status})`);
      }

      const [tData, oData, iData] = await Promise.all([
        tRes.json(), oRes.json(), iRes.json(),
      ]);

      const currentIds = new Set(
        oData.filter((o) => o.status !== "paid").map((o) => String(o.id))
      );

      // Detect new orders on the page side too (belt + suspenders)
      if (isBackground && prevPendingIds.current.size > 0) {
        const newOnes = oData.filter(
          (o) => o.status !== "paid" && !prevPendingIds.current.has(String(o.id))
        );
        if (newOnes.length > 0) {
          newOnes.forEach((o) => {
            addToast({
              icon: "🔥",
              title: `New Order! Table ${o.table_id}`,
              body: `${o.customer_name} · ₹${o.total}`,
              type: "order",
            });
          });
          setNewOrderBanner({ count: newOnes.length, time: new Date() });
          setTimeout(() => setNewOrderBanner(null), 8000);
        }
      }

      setItemStatus((prev) => {
        const next = { ...prev };
        oData.filter((o) => o.status !== "paid" && !prev[o.id]).forEach((o) => {
          next[o.id] = Object.fromEntries((o.items || []).map((_, i) => [i, "pending"]));
        });
        return next;
      });

      prevPendingIds.current = currentIds;

      navigator.serviceWorker?.controller?.postMessage({
        type: "UPDATE_IDS",
        knownIds: [...currentIds],
      });

      setTables(tData);
      setOrders(oData);
      setIncome(iData.total_income ?? 0);
      setLastUpdated(new Date());
      setError(null);

    } catch (e) {
      console.error("fetchAll:", e);
      setError(e.message || "Connection error");
      if (!isBackground) {
        addToast({ icon: "📡", title: "Connection error", body: e.message, type: "error" });
      }
    } finally {
      fetchingRef.current = false;
      if (!isBackground) setLoading(false);
    }
  }, [token, authH, addToast, handleLogout]);

  const fetchStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const [dRes, mRes] = await Promise.all([
        fetch(`${API}/stats/daily`, { headers: authH() }),
        fetch(`${API}/stats/monthly`, { headers: authH() }),
      ]);
      if (!dRes.ok || !mRes.ok) throw new Error("Stats fetch failed");
      setDaily(await dRes.json());
      setMonthly(await mRes.json());
    } catch (e) {
      addToast({ icon: "📊", title: "Could not load stats", body: e.message, type: "error" });
    } finally {
      setStatsLoading(false);
    }
  }, [authH, addToast]);

  // ── Init effects ──
  useEffect(() => {
    if (!token) return;

    setupNotifications();
    fetchAll(false);

    // Page-level polling
    pollingRef.current = setInterval(() => fetchAll(true), POLL_MS);

    // Heartbeat to SW so it knows page is alive
    heartbeatRef.current = setInterval(() => {
      navigator.serviceWorker?.controller?.postMessage({ type: "HEARTBEAT" });
    }, 10000);

    // SW messages → refresh page
    const onSWMessage = (event) => {
      const { type } = event.data || {};
      if (type === "PING" || type === "NEW_ORDER") {
        fetchAll(true);
      }
      if (type === "NEW_ORDER" && event.data.count > 0) {
        setNewOrderBanner({ count: event.data.count, time: new Date() });
        setTimeout(() => setNewOrderBanner(null), 8000);
      }
      // If SW says 401 happened
      if (type === "PING" && event.data?.logout) {
        handleLogout();
      }
    };
    navigator.serviceWorker?.addEventListener("message", onSWMessage);

    // Visibility change → refresh immediately
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        clearInterval(pollingRef.current);
        fetchAll(false);
        pollingRef.current = setInterval(() => fetchAll(true), POLL_MS);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    // Focus → refresh
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

  // ── Order actions ──
  const toggleItem = useCallback((orderId, itemIdx) => {
    setItemStatus((prev) => ({
      ...prev,
      [orderId]: {
        ...prev[orderId],
        [itemIdx]: prev[orderId]?.[itemIdx] === "ready" ? "pending" : "ready",
      },
    }));
  }, []);

  const updateStatus = useCallback(async (orderId, status) => {
    try {
      const res = await fetch(`${API}/orders/${orderId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authH() },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Update failed");
      if (status === "ready") {
        setItemStatus((prev) => {
          const order = orders.find((o) => o.id === orderId);
          if (!order) return prev;
          return {
            ...prev,
            [orderId]: Object.fromEntries((order.items || []).map((_, i) => [i, "ready"])),
          };
        });
        addToast({ icon: "✅", title: `Order #${orderId} marked ready`, type: "success" });
      }
      fetchAll(false);
    } catch (e) {
      addToast({ icon: "❌", title: "Update failed", body: e.message, type: "error" });
    }
  }, [authH, orders, addToast, fetchAll]);

  const markPaid = useCallback(async (orderId) => {
    try {
      const res = await fetch(`${API}/orders/${orderId}/pay`, {
        method: "PUT", headers: authH(),
      });
      if (!res.ok) throw new Error("Payment update failed");
      setItemStatus((prev) => { const n = { ...prev }; delete n[orderId]; return n; });
      addToast({ icon: "💰", title: `Order #${orderId} marked paid`, type: "success" });
      fetchAll(false);
      if (tab === "stats") fetchStats();
    } catch (e) {
      addToast({ icon: "❌", title: "Could not mark paid", body: e.message, type: "error" });
    }
  }, [authH, addToast, fetchAll, fetchStats, tab]);

  const sendWhatsApp = useCallback((order) => {
    let phone = order.whatsapp.replace(/\D/g, "");
    if (phone.length === 10) phone = "91" + phone;
    const itemsList = order.items.map((item, i) =>
      `${i + 1}. ${item.name}\n   Qty: ${item.quantity} × ₹${item.price}\n   Amount: ₹${item.price * item.quantity}`
    ).join("\n\n");
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const msg = `*50-50 CHINESE FAST FOOD*\nCIDCO, Chhatrapati Sambhajinagar\n\n============================\n        INVOICE\n============================\n\nOrder ID : ${order.id}\nTable No : ${order.table_id}\nCustomer : ${order.customer_name}\nTime     : ${time}\n\n----------------------------\n      ITEM DETAILS\n----------------------------\n\n${itemsList}\n\n----------------------------\n TOTAL PAYABLE : Rs.${order.total}\n----------------------------\n\n  Thank you for dining with us!\n  We look forward to serving you again.\n\n  Feedback & Enquiry:\n  +91-88301 46272\n\n============================\n   *50-50 CHINESE FAST FOOD*\n============================`;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, "_blank");
  }, []);

  const downloadCSV = useCallback(async () => {
    setCsvLoading(true);
    try {
      const res = await fetch(`${API}/stats/monthly/csv?month=${csvMonth}`, { headers: authH() });
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `orders_${csvMonth}.csv`; a.click();
      URL.revokeObjectURL(url);
      addToast({ icon: "📥", title: "CSV downloaded!", type: "success" });
    } catch (e) {
      addToast({ icon: "❌", title: "Download failed", body: e.message, type: "error" });
    } finally {
      setCsvLoading(false);
    }
  }, [csvMonth, authH, addToast]);

  // ── Derived data ──
  const pendingOrders = orders.filter((o) => o.status !== "paid");
  const paidOrders = orders.filter((o) => o.status === "paid");
  const monthOpts = getMonthOptions();
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayStats = daily.find((d) => d.date === todayStr) || { total_orders: 0, total_income: 0, avg_order_value: 0 };
  const thisMonth = monthly[0] || { total_orders: 0, total_income: 0, avg_order_value: 0, month_label: "" };

  if (!token) return null;

  return (
    <div style={S.page}>
      <style>{css}</style>

      {/* ── Toasts ── */}
      <Toast toasts={toasts} onDismiss={dismissToast} />

      {/* ── New Order Banner ── */}
      {newOrderBanner && (
        <div style={S.newOrderBanner} className="new-order-banner">
          <span style={{ fontSize: 20 }}>🔥</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>
              {newOrderBanner.count} New Order{newOrderBanner.count > 1 ? "s" : ""} Arrived!
            </div>
            <div style={{ fontSize: 12, opacity: 0.85 }}>
              {newOrderBanner.time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </div>
          </div>
          <button
            style={S.bannerDismiss}
            onClick={() => setNewOrderBanner(null)}
          >✕</button>
        </div>
      )}

      {/* ── TOP BAR ── */}
      <div style={S.topBar}>
        <div style={S.brand}>
          <span style={S.brandDot} />
          <span style={S.brandName}>50-50 Admin</span>
          {lastUpdated && (
            <span style={S.liveChip}>
              <span style={S.liveDot} />
              LIVE
            </span>
          )}
        </div>

        <div style={S.tabs}>
          <button
            style={{ ...S.tabBtn, ...(tab === "orders" ? S.tabActive : {}) }}
            onClick={() => setTab("orders")}
          >
            📋 Orders
            {pendingOrders.length > 0 && (
              <span style={S.tabBadge}>{pendingOrders.length}</span>
            )}
          </button>
          <button
            style={{ ...S.tabBtn, ...(tab === "stats" ? S.tabActive : {}) }}
            onClick={() => setTab("stats")}
          >
            📊 Stats
          </button>
        </div>

        <button style={S.logoutBtn} onClick={handleLogout}>Logout</button>
      </div>

      {/* ── NOTIFICATION BANNER ── */}
      {notifStatus !== "granted" && (
        <div style={S.notifBar}>
          <span>{notifStatus === "denied"
            ? "⚠️ Notifications blocked — go to Site Settings → Allow notifications for this site"
            : "🔔 Enable notifications to never miss a new order"}</span>
          {notifStatus !== "denied" && (
            <button style={S.notifEnableBtn} onClick={setupNotifications}>
              Enable Now
            </button>
          )}
        </div>
      )}

      {/* ── ERROR BAR ── */}
      {error && (
        <div style={S.errorBar}>
          <span>📡 {error} — retrying automatically…</span>
          <button style={S.retryBtn} onClick={() => fetchAll(false)}>Retry Now</button>
        </div>
      )}

      {/* ══════════════ ORDERS TAB ══════════════ */}
      {tab === "orders" && (
        loading ? (
          <div style={S.loader}>
            <div style={S.spinner} />
            <div style={{ marginTop: 16, color: "#999", fontSize: 14 }}>Loading orders…</div>
          </div>
        ) : (
          <div style={S.wrap}>
            {/* KPIs */}
            <div style={S.kpiGrid} className="kpi-grid">
              {[
                { label: "Today's Income", value: `₹${income.toLocaleString("en-IN")}`, accent: "#FF6B35", icon: "💰" },
                { label: "Total Orders", value: orders.length, accent: "#1565C0", icon: "📦" },
                { label: "Pending", value: pendingOrders.length, accent: "#E53935", icon: "⏳" },
                { label: "Completed", value: paidOrders.length, accent: "#2E7D32", icon: "✅" },
              ].map((k) => (
                <div key={k.label} style={S.kpiCard} className="kpi-card">
                  <div style={S.kpiIcon}>{k.icon}</div>
                  <div style={S.kpiValue} className="kpi-value" style2={{ color: k.accent }}>{k.value}</div>
                  <div style={S.kpiLabel}>{k.label}</div>
                  <div style={{ ...S.kpiAccentBar, background: k.accent }} />
                </div>
              ))}
            </div>

            {/* Tables */}
            <div style={S.section}>
              <div style={S.secHead}>
                <span style={S.secTitle}>🪑 Table Status</span>
                <span style={S.badge}>{tables.length} tables</span>
              </div>
              <div style={S.tblGrid} className="tbl-grid">
                {tables.map((t) => (
                  <div key={t.number} style={{
                    ...S.tblCard,
                    borderColor: t.status === "free" ? "#4CAF50" : "#F44336",
                    background: t.status === "free" ? "#F1FBF1" : "#FFF3F3",
                  }}>
                    <div style={S.tblNum}>T{t.number}</div>
                    <div style={{
                      ...S.tblStatus,
                      color: t.status === "free" ? "#2E7D32" : "#C62828",
                    }}>
                      {t.status === "free" ? "Free" : "Busy"}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Pending Orders */}
            <div style={S.section}>
              <div style={S.secHead}>
                <span style={S.secTitle}>⏳ Pending Orders</span>
                <span style={{ ...S.badge, background: "#FFEBEE", color: "#C62828" }}>
                  {pendingOrders.length}
                </span>
              </div>
              {pendingOrders.length === 0 ? (
                <div style={S.empty}>
                  <div style={{ fontSize: 40, marginBottom: 8 }}>🎉</div>
                  <div style={{ fontWeight: 600, color: "#555" }}>All clear! No pending orders.</div>
                </div>
              ) : pendingOrders.map((o) => {
                const iStatus = itemStatus[o.id] || {};
                const allReady = (o.items || []).every((_, i) => iStatus[i] === "ready");
                const readyCount = (o.items || []).filter((_, i) => iStatus[i] === "ready").length;
                const totalItems = (o.items || []).length;
                const progress = totalItems > 0 ? (readyCount / totalItems) * 100 : 0;

                return (
                  <div key={o.id} style={S.orderCard} className="order-card">
                    {/* Order Header */}
                    <div style={S.orderHeader}>
                      <div style={S.orderHeaderLeft}>
                        <span style={S.orderId}>#{o.id}</span>
                        <span style={S.tableChip}>Table {o.table_id}</span>
                        <span style={{
                          ...S.statusChip,
                          background: o.status === "ready" ? "#E8F5E9"
                            : o.status === "preparing" ? "#FFF8E1" : "#F5F5F5",
                          color: o.status === "ready" ? "#2E7D32"
                            : o.status === "preparing" ? "#E65100" : "#757575",
                        }}>
                          {o.status === "ready" ? "✅ Ready"
                            : o.status === "preparing" ? "👨‍🍳 Preparing" : "🆕 New"}
                        </span>
                      </div>
                      <div style={S.orderTotal}>₹{o.total}</div>
                    </div>

                    {/* Customer info */}
                    <div style={S.customerRow}>
                      <span style={S.customerName}>👤 {o.customer_name}</span>
                      <span style={S.customerPhone}>📱 {o.whatsapp}</span>
                    </div>

                    {/* Progress bar */}
                    <div style={S.progressWrap}>
                      <div style={S.progressLabel}>
                        <span>Items Ready</span>
                        <span style={{ fontWeight: 700 }}>{readyCount}/{totalItems}</span>
                      </div>
                      <div style={S.progressTrack}>
                        <div style={{
                          ...S.progressFill,
                          width: `${progress}%`,
                          background: progress === 100 ? "#4CAF50" : "#FF6B35",
                        }} />
                      </div>
                    </div>

                    {/* Items */}
                    <div style={S.itemsGrid}>
                      {o.items?.map((item, i) => {
                        const ready = iStatus[i] === "ready";
                        return (
                          <div
                            key={i}
                            style={{
                              ...S.itemRow,
                              background: ready ? "#E8F5E9" : "#FFFBF0",
                              borderColor: ready ? "#A5D6A7" : "#FFE0B2",
                            }}
                            onClick={() => toggleItem(o.id, i)}
                          >
                            <span style={S.itemQty}>{item.quantity}×</span>
                            <span style={S.itemName}>{item.name}</span>
                            <span style={S.itemPrice}>₹{item.price * item.quantity}</span>
                            <span style={{
                              ...S.itemBadge,
                              background: ready ? "#4CAF50" : "#FF9800",
                              color: "#FFF",
                            }}>
                              {ready ? "✓" : "○"}
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    {/* Actions */}
                    <div style={S.actionRow}>
                      {allReady ? (
                        <button style={{ ...S.btn, ...S.btnGrey }}
                          onClick={() => updateStatus(o.id, "pending")}>
                          ↩ Mark Pending
                        </button>
                      ) : (
                        <button style={{ ...S.btn, ...S.btnGreen }}
                          onClick={() => updateStatus(o.id, "ready")}>
                          ✓ Mark All Ready
                        </button>
                      )}
                      <button style={{ ...S.btn, ...S.btnWA }}
                        onClick={() => sendWhatsApp(o)}>
                        📤 Send Bill
                      </button>
                      <button style={{ ...S.btn, ...S.btnOrange }}
                        onClick={() => markPaid(o.id)}>
                        💰 Paid ✓
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Completed Orders */}
            <div style={S.section}>
              <div style={S.secHead}>
                <span style={S.secTitle}>✅ Completed Orders</span>
                <span style={{ ...S.badge, background: "#E8F5E9", color: "#2E7D32" }}>
                  {paidOrders.length}
                </span>
              </div>
              {paidOrders.length === 0 ? (
                <div style={S.empty}>No completed orders yet</div>
              ) : paidOrders.map((o) => (
                <div key={o.id} style={{ ...S.orderCard, opacity: 0.75 }} className="order-card">
                  <div style={S.orderHeader}>
                    <div style={S.orderHeaderLeft}>
                      <span style={S.orderId}>#{o.id}</span>
                      <span style={S.tableChip}>Table {o.table_id}</span>
                      <span style={{ ...S.statusChip, background: "#E8F5E9", color: "#2E7D32" }}>
                        💰 Paid
                      </span>
                    </div>
                    <div style={S.orderTotal}>₹{o.total}</div>
                  </div>
                  <div style={S.customerRow}>
                    <span style={S.customerName}>👤 {o.customer_name}</span>
                    <span style={S.customerPhone}>📱 {o.whatsapp}</span>
                  </div>
                  <div style={S.actionRow}>
                    <button style={{ ...S.btn, ...S.btnWA }}
                      onClick={() => sendWhatsApp(o)}>
                      📤 Send Bill
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      )}

      {/* ══════════════ STATS TAB ══════════════ */}
      {tab === "stats" && (
        statsLoading ? (
          <div style={S.loader}>
            <div style={S.spinner} />
            <div style={{ marginTop: 16, color: "#999", fontSize: 14 }}>Loading stats…</div>
          </div>
        ) : (
          <div style={S.wrap}>
            {/* Summary KPIs */}
            <div style={S.kpiGrid} className="kpi-grid">
              {[
                { label: "Today's Income", value: `₹${todayStats.total_income}`, icon: "📈", accent: "#FF6B35" },
                { label: "Today's Orders", value: todayStats.total_orders, icon: "📦", accent: "#1565C0" },
                { label: "Month Income", value: `₹${thisMonth.total_income}`, icon: "📅", accent: "#7B1FA2" },
                { label: "Month Orders", value: thisMonth.total_orders, icon: "🗓", accent: "#00897B" },
              ].map((k) => (
                <div key={k.label} style={S.kpiCard} className="kpi-card">
                  <div style={S.kpiIcon}>{k.icon}</div>
                  <div style={{ ...S.kpiValue, color: k.accent }}>{k.value}</div>
                  <div style={S.kpiLabel}>{k.label}</div>
                  <div style={{ ...S.kpiAccentBar, background: k.accent }} />
                </div>
              ))}
            </div>

            {/* CSV Download */}
            <div style={S.section}>
              <div style={S.secHead}>
                <span style={S.secTitle}>📥 Export Report</span>
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <select value={csvMonth} onChange={(e) => setCsvMonth(e.target.value)} style={S.select}>
                  {monthOpts.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
                <button style={{ ...S.btn, ...S.btnGreen }} onClick={downloadCSV} disabled={csvLoading}>
                  {csvLoading ? "⏳ Downloading…" : "⬇ Download CSV"}
                </button>
              </div>
              <div style={{ marginTop: 8, fontSize: 12, color: "#999" }}>
                Includes: Order ID, Date, Time, Table, Customer, Items, Total
              </div>
            </div>

            {/* Daily table */}
            <div style={S.section}>
              <div style={S.secHead}>
                <span style={S.secTitle}>📅 Daily Breakdown — Last 30 Days</span>
                <button style={{ ...S.btn, ...S.btnGrey, padding: "6px 14px" }} onClick={fetchStats}>
                  ↺ Refresh
                </button>
              </div>
              {daily.length === 0 ? (
                <div style={S.empty}>No data yet</div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={S.table}>
                    <thead>
                      <tr>
                        {["Date", "Orders", "Income", "Avg Order"].map((h) => (
                          <th key={h} style={S.th}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {daily.map((d, i) => (
                        <tr key={i} style={{ background: i % 2 === 0 ? "#FFF" : "#FAFAFA" }}>
                          <td style={S.td}>{d.date}</td>
                          <td style={S.td}>{d.total_orders}</td>
                          <td style={{ ...S.td, fontWeight: 600, color: "#FF6B35" }}>₹{d.total_income}</td>
                          <td style={S.td}>₹{d.avg_order_value}</td>
                        </tr>
                      ))}
                      <tr style={{ background: "#FFF3E0", fontWeight: 700 }}>
                        <td style={S.td}>Total</td>
                        <td style={S.td}>{daily.reduce((s, d) => s + d.total_orders, 0)}</td>
                        <td style={{ ...S.td, color: "#FF6B35" }}>₹{daily.reduce((s, d) => s + d.total_income, 0).toFixed(2)}</td>
                        <td style={S.td}></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Monthly table */}
            <div style={S.section}>
              <div style={S.secHead}>
                <span style={S.secTitle}>📆 Monthly Summary — Last 12 Months</span>
              </div>
              {monthly.length === 0 ? (
                <div style={S.empty}>No data yet</div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={S.table}>
                    <thead>
                      <tr>
                        {["Month", "Orders", "Income", "Avg Order", "Best Day"].map((h) => (
                          <th key={h} style={S.th}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {monthly.map((m, i) => (
                        <tr key={i} style={{ background: i % 2 === 0 ? "#FFF" : "#FAFAFA" }}>
                          <td style={{ ...S.td, fontWeight: 600 }}>{m.month_label}</td>
                          <td style={S.td}>{m.total_orders}</td>
                          <td style={{ ...S.td, fontWeight: 600, color: "#FF6B35" }}>₹{m.total_income}</td>
                          <td style={S.td}>₹{m.avg_order_value}</td>
                          <td style={S.td}>{m.best_day?.trim() || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )
      )}

      {/* Last updated footer */}
      {lastUpdated && (
        <div style={S.footer}>
          Last updated: {lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────
const S = {
  page: {
    background: "#F7F7F8",
    minHeight: "100vh",
    fontFamily: "'Nunito', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    paddingBottom: 40,
  },
  topBar: {
    background: "#1A1A2E",
    padding: "0 16px",
    display: "flex",
    alignItems: "center",
    gap: 8,
    position: "sticky",
    top: 0,
    zIndex: 100,
    boxShadow: "0 2px 12px rgba(0,0,0,0.25)",
    height: 56,
  },
  brand: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginRight: "auto",
    flexShrink: 0,
  },
  brandDot: {
    width: 10, height: 10,
    borderRadius: "50%",
    background: "#FF6B35",
    boxShadow: "0 0 8px #FF6B35",
  },
  brandName: {
    color: "#FFF",
    fontWeight: 800,
    fontSize: 15,
    letterSpacing: 0.3,
  },
  liveChip: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    background: "rgba(76,175,80,0.18)",
    border: "1px solid #4CAF50",
    borderRadius: 20,
    padding: "2px 8px",
    fontSize: 10,
    fontWeight: 700,
    color: "#4CAF50",
    letterSpacing: 1,
  },
  liveDot: {
    width: 5, height: 5,
    borderRadius: "50%",
    background: "#4CAF50",
    animation: "pulse 1.5s infinite",
  },
  tabs: {
    display: "flex",
    gap: 4,
  },
  tabBtn: {
    background: "transparent",
    border: "none",
    padding: "8px 14px",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 600,
    color: "rgba(255,255,255,0.5)",
    borderRadius: 8,
    display: "flex",
    alignItems: "center",
    gap: 6,
    transition: "all 0.2s",
  },
  tabActive: {
    background: "rgba(255,107,53,0.15)",
    color: "#FF6B35",
  },
  tabBadge: {
    background: "#FF3B3B",
    color: "#FFF",
    borderRadius: 20,
    padding: "1px 7px",
    fontSize: 11,
    fontWeight: 700,
    minWidth: 20,
    textAlign: "center",
    animation: "badgePop 0.3s ease",
  },
  logoutBtn: {
    background: "rgba(239,79,95,0.15)",
    color: "#EF4F5F",
    border: "1px solid rgba(239,79,95,0.3)",
    padding: "6px 14px",
    borderRadius: 8,
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 700,
    flexShrink: 0,
  },
  notifBar: {
    background: "#FFF8E1",
    borderBottom: "1px solid #FFE082",
    padding: "9px 16px",
    fontSize: 12,
    color: "#6D4C00",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
  },
  notifEnableBtn: {
    background: "#FF6B35",
    color: "#FFF",
    border: "none",
    padding: "5px 14px",
    borderRadius: 6,
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 700,
    flexShrink: 0,
  },
  errorBar: {
    background: "#FFEBEE",
    borderBottom: "1px solid #EF9A9A",
    padding: "9px 16px",
    fontSize: 12,
    color: "#B71C1C",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
  },
  retryBtn: {
    background: "#E53935",
    color: "#FFF",
    border: "none",
    padding: "5px 14px",
    borderRadius: 6,
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 700,
    flexShrink: 0,
  },
  newOrderBanner: {
    background: "linear-gradient(135deg, #FF6B35, #FF3B3B)",
    color: "#FFF",
    padding: "12px 16px",
    display: "flex",
    alignItems: "center",
    gap: 12,
    boxShadow: "0 4px 16px rgba(255,107,53,0.4)",
    position: "relative",
  },
  bannerDismiss: {
    background: "rgba(255,255,255,0.2)",
    border: "none",
    color: "#FFF",
    width: 28, height: 28,
    borderRadius: "50%",
    cursor: "pointer",
    fontSize: 14,
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  wrap: {
    maxWidth: 1400,
    margin: "0 auto",
    padding: "20px 16px",
    boxSizing: "border-box",
  },
  loader: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: 80,
  },
  spinner: {
    width: 36, height: 36,
    border: "3px solid #F0F0F0",
    borderTop: "3px solid #FF6B35",
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
  },
  kpiGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    gap: 12,
    marginBottom: 20,
  },
  kpiCard: {
    background: "#FFF",
    borderRadius: 14,
    padding: "18px 16px 14px",
    border: "1px solid #EBEBEB",
    position: "relative",
    overflow: "hidden",
    boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
  },
  kpiIcon: { fontSize: 22, marginBottom: 8 },
  kpiValue: {
    fontSize: 28, fontWeight: 800,
    color: "#1A1A2E",
    lineHeight: 1,
    marginBottom: 4,
  },
  kpiLabel: {
    fontSize: 11, fontWeight: 600,
    color: "#9E9E9E",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  kpiAccentBar: {
    position: "absolute",
    bottom: 0, left: 0, right: 0,
    height: 3,
    borderRadius: "0 0 14px 14px",
  },
  section: {
    background: "#FFF",
    borderRadius: 14,
    padding: "18px 16px",
    marginBottom: 14,
    border: "1px solid #EBEBEB",
    boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
  },
  secHead: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
    paddingBottom: 12,
    borderBottom: "1px solid #F5F5F5",
  },
  secTitle: { fontSize: 14, fontWeight: 800, color: "#1A1A2E" },
  badge: {
    background: "#F0F0F0",
    color: "#555",
    padding: "3px 10px",
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 700,
  },
  tblGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))",
    gap: 8,
  },
  tblCard: {
    padding: "10px 6px",
    borderRadius: 10,
    border: "2px solid",
    textAlign: "center",
    transition: "transform 0.15s",
  },
  tblNum: { fontSize: 15, fontWeight: 800, color: "#1A1A2E" },
  tblStatus: { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3 },
  empty: {
    padding: "32px 16px",
    textAlign: "center",
    color: "#BDBDBD",
    fontSize: 14,
    background: "#FAFAFA",
    borderRadius: 10,
  },
  orderCard: {
    background: "#FAFAFA",
    borderRadius: 12,
    border: "1px solid #EFEFEF",
    padding: 14,
    marginBottom: 10,
    transition: "box-shadow 0.2s",
  },
  orderHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
    flexWrap: "wrap",
    gap: 6,
  },
  orderHeaderLeft: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  orderId: { fontSize: 14, fontWeight: 800, color: "#1A1A2E" },
  tableChip: {
    background: "#E8EAF6",
    color: "#3949AB",
    padding: "2px 9px",
    borderRadius: 6,
    fontSize: 11,
    fontWeight: 700,
  },
  statusChip: {
    padding: "2px 9px",
    borderRadius: 6,
    fontSize: 11,
    fontWeight: 700,
  },
  orderTotal: { fontSize: 18, fontWeight: 800, color: "#FF6B35" },
  customerRow: {
    display: "flex",
    gap: 12,
    marginBottom: 10,
    flexWrap: "wrap",
  },
  customerName: { fontSize: 12, color: "#424242", fontWeight: 600 },
  customerPhone: { fontSize: 12, color: "#9E9E9E" },
  progressWrap: { marginBottom: 10 },
  progressLabel: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: 11,
    color: "#757575",
    fontWeight: 600,
    marginBottom: 4,
  },
  progressTrack: {
    height: 5,
    background: "#F0F0F0",
    borderRadius: 10,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 10,
    transition: "width 0.4s ease, background 0.3s ease",
  },
  itemsGrid: { marginBottom: 12 },
  itemRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "7px 10px",
    borderRadius: 8,
    border: "1px solid",
    marginBottom: 5,
    cursor: "pointer",
    transition: "all 0.2s",
  },
  itemQty: {
    background: "#EEEEEE",
    color: "#424242",
    padding: "1px 7px",
    borderRadius: 5,
    fontWeight: 700,
    fontSize: 12,
    flexShrink: 0,
  },
  itemName: { flex: 1, fontSize: 12, color: "#424242", fontWeight: 600 },
  itemPrice: { fontSize: 12, fontWeight: 700, color: "#1A1A2E", flexShrink: 0 },
  itemBadge: {
    width: 22, height: 22,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 11,
    fontWeight: 700,
    flexShrink: 0,
    transition: "all 0.2s",
  },
  actionRow: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },
  btn: {
    border: "none",
    padding: "8px 14px",
    borderRadius: 8,
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 700,
    minHeight: 36,
    transition: "opacity 0.15s",
  },
  btnGreen: { background: "#2E7D32", color: "#FFF" },
  btnWA: { background: "#25D366", color: "#FFF" },
  btnOrange: { background: "#FF6B35", color: "#FFF" },
  btnGrey: { background: "#546E7A", color: "#FFF" },
  select: {
    padding: "9px 12px",
    borderRadius: 8,
    border: "1px solid #E0E0E0",
    fontSize: 13,
    background: "#FFF",
    cursor: "pointer",
    minWidth: 180,
    fontFamily: "inherit",
  },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: {
    background: "#F5F5F5",
    padding: "10px 14px",
    textAlign: "left",
    fontWeight: 700,
    color: "#757575",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    borderBottom: "2px solid #EEEEEE",
    whiteSpace: "nowrap",
  },
  td: { padding: "10px 14px", borderBottom: "1px solid #F5F5F5", color: "#1A1A2E" },
  footer: {
    textAlign: "center",
    padding: "12px",
    fontSize: 11,
    color: "#BDBDBD",
    borderTop: "1px solid #F0F0F0",
    marginTop: 8,
  },
};

const css = `
@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@600;700;800&display=swap');

* { box-sizing: border-box; }

@keyframes spin { to { transform: rotate(360deg); } }
@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(0.8); }
}
@keyframes slideIn {
  from { transform: translateX(120%); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}
@keyframes badgePop {
  0% { transform: scale(0.5); }
  70% { transform: scale(1.2); }
  100% { transform: scale(1); }
}
@keyframes bannerSlide {
  from { transform: translateY(-100%); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

.new-order-banner { animation: bannerSlide 0.4s cubic-bezier(0.34,1.56,0.64,1); }

.kpi-card:hover { box-shadow: 0 6px 20px rgba(0,0,0,0.08) !important; transform: translateY(-1px); }
.order-card:hover { box-shadow: 0 4px 16px rgba(0,0,0,0.08) !important; }

button:active { opacity: 0.75 !important; transform: scale(0.97); }

@media (min-width: 1024px) {
  .kpi-grid { grid-template-columns: repeat(4, 1fr) !important; }
}
@media (max-width: 768px) {
  .kpi-grid { grid-template-columns: repeat(2, 1fr) !important; }
  .tbl-grid { grid-template-columns: repeat(auto-fill, minmax(60px, 1fr)) !important; }
}
@media (max-width: 480px) {
  .wrap { padding: 10px 10px !important; }
}
@media (hover: none) and (pointer: coarse) {
  button { min-height: 44px !important; -webkit-tap-highlight-color: transparent; }
}
`;

export default AdminDashboard;
