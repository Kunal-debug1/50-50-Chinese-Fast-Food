import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useHotel } from "../context/HotelContext";

const API = "https://five0-50-chinese-fast-food-6.onrender.com";

// ── Matches AdminDashboard status config exactly ──
// DB values: "pending" | "ready" | "paid"
const STATUS_LABEL = {
  pending: "Preparing",
  ready:   "Ready",
  paid:    "Paid",
};

const STATUS_STYLE = {
  pending: { background: "#FFF3E0", color: "#F57C00" },
  ready:   { background: "#E8F5E9", color: "#388E3C" },
  paid:    { background: "#E8F5E9", color: "#388E3C" },
};

const BORDER_COLOR = {
  pending: "#FFC107",
  ready:   "#2196F3",
  paid:    "#4CAF50",
};

function OrderStatus() {
  const { selectedTable, endSession } = useHotel();
  const navigate = useNavigate();

  const [orders,     setOrders]     = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(new Date());

  // ✅ Fetch orders with proper error handling
  const fetchOrders = async (showRefreshing = true) => {
    const sessionId = localStorage.getItem("sessionId");

    if (!selectedTable || !sessionId) {
      setLoading(false);
      return;
    }

    if (showRefreshing) setRefreshing(true);

    try {
      const res = await fetch(
        `${API}/orders/table/${selectedTable.id}?session_id=${sessionId}`
      );

      if (!res.ok) throw new Error("Failed to fetch orders");

      const data = await res.json();
      setOrders(Array.isArray(data) ? data : []);
      setLastUpdate(new Date());
    } catch (err) {
      console.error("Error fetching orders:", err);
      // Keep existing orders on error
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // ✅ Initial fetch
  useEffect(() => {
    fetchOrders(false);
  }, [selectedTable]);

  // ✅ Auto-refresh every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      fetchOrders();
    }, 5000);

    return () => clearInterval(interval);
  }, [selectedTable]);

  // ✅ Handle session expiry
  if (!selectedTable) {
    return (
      <div className="error-container" style={styles.errorContainer}>
        <style>{mediaQueries}</style>
        <div style={styles.errorCard}>
          <div style={styles.errorIcon}>⚠️</div>
          <p style={styles.errorText}>Session expired.</p>
          <p style={styles.errorSubtext}>Please select a table to continue.</p>
          <button
            style={styles.errorBtn}
            onClick={() => navigate("/")}
          >
            ← Go Back
          </button>
        </div>
      </div>
    );
  }

  // ✅ Loading state
  if (loading && orders.length === 0) {
    return (
      <div className="error-container" style={styles.errorContainer}>
        <style>{mediaQueries}</style>
        <div style={styles.loadingCard}>
          <div style={styles.spinner}></div>
          <p style={styles.errorText}>Loading orders...</p>
        </div>
      </div>
    );
  }

  // ✅ Calculate order status
  const latestOrder = orders[orders.length - 1];
  const allPaid  = orders.length > 0 && orders.every((o) => o.status === "paid");
  const anyReady = orders.some((o) => o.status === "ready");
  const totalAmount = orders.reduce((sum, o) => sum + parseFloat(o.total || 0), 0);

  return (
    <div className="order-status-wrapper" style={styles.container}>
      <style>{mediaQueries}</style>

      <div className="order-status-card" style={styles.card}>
        {/* HEADER */}
        <div style={styles.cardHeader}>
          <h2 style={styles.heading}>
            🪑 Table {selectedTable.number}
          </h2>
          {refreshing && <span style={styles.refreshBadge}>Updating...</span>}
        </div>

        {/* STATS SECTION */}
        {orders.length > 0 && (
          <div style={styles.statsSection}>
            <div style={styles.statItem}>
              <span style={styles.statLabel}>Total Orders</span>
              <span style={styles.statValue}>{orders.length}</span>
            </div>
            <div style={styles.statItem}>
              <span style={styles.statLabel}>Total Amount</span>
              <span style={styles.statValue}>₹{totalAmount.toFixed(0)}</span>
            </div>
          </div>
        )}

        {/* ORDERS LIST */}
        {orders.length === 0 ? (
          <div style={styles.emptyState}>
            <p style={styles.emptyIcon}>🛒</p>
            <p style={styles.emptyText}>No orders yet</p>
            <p style={styles.emptySubtext}>Start by adding items from the menu</p>
          </div>
        ) : (
          <div className="orders-container" style={styles.ordersContainer}>
            {orders.map((order) => (
              <div
                key={order.id}
                className="order-box"
                style={{
                  ...styles.orderBox,
                  borderLeft: `4px solid ${BORDER_COLOR[order.status] || BORDER_COLOR.pending}`,
                  background: order.status === "paid" ? "#F1F8E9" : "#FFFBF0",
                }}
              >
                <div style={styles.orderHeader}>
                  <span style={styles.orderNumber}>Order #{order.id}</span>
                  {/* ✅ Status badge using same config as AdminDashboard */}
                  <span style={{
                    ...styles.orderStatusBadge,
                    ...(STATUS_STYLE[order.status] || STATUS_STYLE.pending),
                    border: `1px solid ${BORDER_COLOR[order.status] || BORDER_COLOR.pending}`,
                  }}>
                    {order.status === "pending" ? "⏳ " : order.status === "ready" ? "✓ " : "✓ "}
                    {STATUS_LABEL[order.status] || order.status}
                  </span>
                </div>

                <div style={styles.orderDetails}>
                  <p style={styles.orderMeta}>
                    <span style={styles.metaLabel}>Items:</span>
                    <span style={styles.metaValue}>
                      {order.items ? order.items.length : 0}
                    </span>
                  </p>
                  <p style={styles.orderTotal}>
                    <span style={styles.totalLabel}>Total:</span>
                    <span style={styles.totalValue}>₹{parseFloat(order.total || 0).toFixed(0)}</span>
                  </p>
                </div>

                {/* ITEMS PREVIEW */}
                {order.items && order.items.length > 0 && (
                  <div style={styles.itemsPreview}>
                    {order.items.slice(0, 3).map((item, i) => (
                      <div key={i} style={styles.itemPreviewRow}>
                        <span style={styles.itemQty}>{item.quantity}x</span>
                        <span style={styles.itemName}>{item.name}</span>
                        <span style={styles.itemAmt}>₹{(parseFloat(item.price || 0) * item.quantity).toFixed(0)}</span>
                      </div>
                    ))}
                    {order.items.length > 3 && (
                      <p style={styles.moreItems}>+{order.items.length - 3} more items</p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* MANUAL REFRESH BUTTON */}
        <button
          style={styles.refreshBtn}
          onClick={() => fetchOrders(true)}
          disabled={refreshing}
        >
          {refreshing ? "⟳ Refreshing..." : "⟳ Refresh"}
        </button>

        {/* ACTION BUTTONS */}
        <div className="buttons-container" style={styles.buttonsContainer}>
          {!allPaid && (
            <button
              className="yellow-btn"
              style={styles.yellowBtn}
              onClick={() => navigate("/menu")}
              title="Add more items to your order"
            >
              + Add More Items
            </button>
          )}

          {anyReady && !allPaid && (
            <div style={styles.readyNotice}>
              <span style={styles.readyIcon}>✓</span>
              <span>Your order is ready! Please collect at the counter.</span>
            </div>
          )}

          {allPaid && (
            <button
              className="green-btn"
              style={styles.greenBtn}
              onClick={() => {
                localStorage.clear();
                endSession();
                navigate("/");
              }}
              title="End your session and exit"
            >
              ✓ Finish & Exit
            </button>
          )}
        </div>

        {/* FOOTER INFO */}
        <div style={styles.footerInfo}>
          <p style={styles.lastUpdate}>
            Last updated: {lastUpdate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </p>
        </div>
      </div>
    </div>
  );
}

/* ================= STYLES ================= */

const styles = {
  container: {
    minHeight: "100vh",
    background: "linear-gradient(135deg, #f9f9f9 0%, #f0f0f0 100%)",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    padding: "20px",
    width: "100%",
    boxSizing: "border-box",
    overflowX: "hidden",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  },

  errorContainer: {
    minHeight: "100vh",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    padding: "20px",
    width: "100%",
    boxSizing: "border-box",
    background: "linear-gradient(135deg, #f9f9f9 0%, #f0f0f0 100%)",
  },

  errorCard: {
    background: "#fff",
    padding: "40px 30px",
    borderRadius: "12px",
    boxShadow: "0 8px 32px rgba(0,0,0,0.1)",
    width: "100%",
    maxWidth: "400px",
    textAlign: "center",
  },

  loadingCard: {
    background: "#fff",
    padding: "40px 30px",
    borderRadius: "12px",
    boxShadow: "0 8px 32px rgba(0,0,0,0.1)",
    width: "100%",
    maxWidth: "400px",
    textAlign: "center",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "20px",
  },

  spinner: {
    width: "40px",
    height: "40px",
    border: "3px solid #f0f0f0",
    borderTop: "3px solid #FFD700",
    borderRadius: "50%",
    animation: "spin 1s linear infinite",
  },

  errorIcon: {
    fontSize: "48px",
    marginBottom: "16px",
  },

  errorText: {
    fontSize: "18px",
    fontWeight: "600",
    color: "#1C1C1C",
    margin: "0 0 8px 0",
  },

  errorSubtext: {
    fontSize: "14px",
    color: "#9C9C9C",
    margin: "0 0 20px 0",
  },

  errorBtn: {
    background: "#FFD700",
    color: "#1C1C1C",
    border: "none",
    padding: "10px 20px",
    borderRadius: "6px",
    fontWeight: "600",
    fontSize: "13px",
    cursor: "pointer",
    transition: "all 0.2s ease",
  },

  card: {
    background: "#fff",
    padding: "30px",
    borderRadius: "12px",
    boxShadow: "0 8px 32px rgba(0,0,0,0.1)",
    width: "100%",
    maxWidth: "550px",
    boxSizing: "border-box",
  },

  cardHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "24px",
    gap: "12px",
  },

  heading: {
    fontSize: "26px",
    fontWeight: "700",
    color: "#1C1C1C",
    margin: 0,
    flex: "1 1 auto",
  },

  refreshBadge: {
    background: "#FFD700",
    color: "#1C1C1C",
    padding: "4px 10px",
    borderRadius: "4px",
    fontSize: "11px",
    fontWeight: "600",
    whiteSpace: "nowrap",
    animation: "pulse 1.5s ease-in-out infinite",
  },

  statsSection: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "12px",
    marginBottom: "20px",
    padding: "16px",
    background: "#FAFAFA",
    borderRadius: "8px",
  },

  statItem: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },

  statLabel: {
    fontSize: "11px",
    fontWeight: "600",
    color: "#9C9C9C",
    textTransform: "uppercase",
  },

  statValue: {
    fontSize: "18px",
    fontWeight: "700",
    color: "#1C1C1C",
  },

  emptyState: {
    textAlign: "center",
    padding: "40px 20px",
    marginBottom: "20px",
  },

  emptyIcon: {
    fontSize: "48px",
    margin: "0 0 12px 0",
    display: "block",
    opacity: 0.6,
  },

  emptyText: {
    fontSize: "16px",
    fontWeight: "600",
    color: "#1C1C1C",
    margin: "0 0 8px 0",
  },

  emptySubtext: {
    fontSize: "13px",
    color: "#9C9C9C",
    margin: 0,
  },

  ordersContainer: {
    marginBottom: "20px",
    maxHeight: "calc(100vh - 400px)",
    overflowY: "auto",
  },

  orderBox: {
    border: "1px solid #E8E8E8",
    padding: "14px",
    borderRadius: "8px",
    marginBottom: "12px",
    background: "#FFFBF0",
    transition: "all 0.2s ease",
  },

  orderHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "10px",
    gap: "12px",
    flexWrap: "wrap",
  },

  orderNumber: {
    fontSize: "14px",
    fontWeight: "700",
    color: "#1C1C1C",
  },

  orderStatusBadge: {
    padding: "4px 10px",
    borderRadius: "20px",
    fontSize: "11px",
    fontWeight: "700",
    whiteSpace: "nowrap",
  },

  orderDetails: {
    margin: "10px 0",
  },

  orderMeta: {
    fontSize: "12px",
    color: "#636363",
    margin: "0 0 6px 0",
    display: "flex",
    justifyContent: "space-between",
  },

  metaLabel: {
    fontWeight: "500",
  },

  metaValue: {
    fontWeight: "600",
    color: "#1C1C1C",
  },

  orderTotal: {
    fontSize: "14px",
    fontWeight: "700",
    color: "#FFD700",
    margin: 0,
    display: "flex",
    justifyContent: "space-between",
  },

  totalLabel: {
    fontWeight: "500",
    color: "#636363",
  },

  totalValue: {
    color: "#FFD700",
  },

  itemsPreview: {
    marginTop: "10px",
    paddingTop: "10px",
    borderTop: "1px solid #E8E8E8",
    fontSize: "11px",
  },

  itemPreviewRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "4px 0",
    color: "#636363",
  },

  itemQty: {
    background: "#F0F0F0",
    color: "#1C1C1C",
    padding: "2px 6px",
    borderRadius: "3px",
    fontWeight: "600",
    minWidth: "28px",
    textAlign: "center",
  },

  itemName: {
    flex: "1 1 auto",
    minWidth: "0",
  },

  itemAmt: {
    fontWeight: "600",
    color: "#1C1C1C",
    whiteSpace: "nowrap",
  },

  moreItems: {
    margin: "6px 0 0 0",
    color: "#9C9C9C",
    fontStyle: "italic",
    fontSize: "10px",
  },

  refreshBtn: {
    width: "100%",
    padding: "10px 14px",
    background: "#F0F0F0",
    border: "1px solid #E8E8E8",
    borderRadius: "6px",
    fontSize: "12px",
    fontWeight: "600",
    color: "#636363",
    cursor: "pointer",
    transition: "all 0.2s ease",
    marginBottom: "16px",
    minHeight: "40px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },

  buttonsContainer: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    marginTop: "16px",
  },

  readyNotice: {
    background: "#E8F5E9",
    border: "1px solid #A5D6A7",
    color: "#2E7D32",
    padding: "10px 14px",
    borderRadius: "6px",
    fontSize: "13px",
    fontWeight: "600",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    justifyContent: "center",
  },

  readyIcon: {
    fontSize: "16px",
  },

  yellowBtn: {
    width: "100%",
    padding: "12px 16px",
    background: "#FFD700",
    border: "none",
    borderRadius: "6px",
    fontWeight: "700",
    fontSize: "14px",
    color: "#1C1C1C",
    cursor: "pointer",
    transition: "all 0.2s ease",
    boxSizing: "border-box",
    minHeight: "48px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },

  greenBtn: {
    width: "100%",
    padding: "12px 16px",
    background: "#4CAF50",
    color: "#fff",
    border: "none",
    borderRadius: "6px",
    fontWeight: "700",
    fontSize: "14px",
    cursor: "pointer",
    transition: "all 0.2s ease",
    boxSizing: "border-box",
    minHeight: "48px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },

  footerInfo: {
    textAlign: "center",
    marginTop: "16px",
    paddingTop: "12px",
    borderTop: "1px solid #F0F0F0",
  },

  lastUpdate: {
    fontSize: "11px",
    color: "#9C9C9C",
    margin: 0,
  },
};

/* ================= MEDIA QUERIES ================= */

const mediaQueries = `
  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
  }

  * {
    box-sizing: border-box;
  }

  /* Desktop - 1024px and above */
  @media (min-width: 1024px) {
    .order-status-wrapper {
      padding: 40px;
    }

    .order-status-card {
      padding: 40px !important;
      max-width: 550px;
    }
  }

  /* Tablet - 768px to 1023px */
  @media (max-width: 1023px) and (min-width: 768px) {
    .order-status-wrapper {
      padding: 24px;
    }

    .order-status-card {
      padding: 28px !important;
      max-width: 100%;
    }

    .heading {
      font-size: 22px !important;
    }
  }

  /* Large Phone - 640px to 767px */
  @media (max-width: 767px) and (min-width: 640px) {
    .order-status-wrapper {
      padding: 16px;
    }

    .order-status-card {
      padding: 20px !important;
      max-width: 100%;
    }

    .heading {
      font-size: 20px !important;
    }

    .order-box {
      padding: 12px !important;
      margin-bottom: 10px !important;
    }

    .order-number {
      font-size: 13px !important;
    }

    .order-total {
      font-size: 13px !important;
    }

    .yellow-btn, .green-btn {
      padding: 11px 14px !important;
      font-size: 13px !important;
      min-height: 44px !important;
    }
  }

  /* Phone - 480px to 639px */
  @media (max-width: 639px) and (min-width: 480px) {
    .order-status-wrapper {
      padding: 12px;
    }

    .order-status-card {
      padding: 16px !important;
      max-width: 100%;
    }

    .card-header {
      margin-bottom: 16px !important;
    }

    .heading {
      font-size: 18px !important;
    }

    .refresh-badge {
      font-size: 10px !important;
    }

    .stats-section {
      padding: 12px !important;
      gap: 10px !important;
      margin-bottom: 16px !important;
    }

    .stat-label {
      font-size: 10px !important;
    }

    .stat-value {
      font-size: 16px !important;
    }

    .order-box {
      padding: 10px !important;
      margin-bottom: 8px !important;
    }

    .order-number {
      font-size: 12px !important;
    }

    .order-status-badge {
      font-size: 10px !important;
      padding: 3px 8px !important;
    }

    .order-meta {
      font-size: 11px !important;
    }

    .order-total {
      font-size: 12px !important;
    }

    .items-preview {
      margin-top: 8px !important;
      padding-top: 8px !important;
    }

    .item-preview-row {
      padding: 2px 0 !important;
      font-size: 10px !important;
    }

    .item-qty {
      font-size: 9px !important;
      min-width: 26px;
    }

    .refresh-btn {
      padding: 8px 12px !important;
      font-size: 11px !important;
      margin-bottom: 12px !important;
      min-height: 36px !important;
    }

    .yellow-btn, .green-btn {
      padding: 10px 12px !important;
      font-size: 12px !important;
      min-height: 40px !important;
      gap: 6px !important;
    }

    .ready-notice {
      padding: 8px 12px !important;
      font-size: 12px !important;
    }

    .last-update {
      font-size: 10px !important;
    }
  }

  /* Small Phone - 360px to 479px */
  @media (max-width: 479px) and (min-width: 360px) {
    .order-status-wrapper {
      padding: 10px;
    }

    .order-status-card {
      padding: 14px !important;
      max-width: 100%;
      border-radius: 10px;
    }

    .card-header {
      margin-bottom: 12px !important;
      flex-wrap: wrap;
    }

    .heading {
      font-size: 16px !important;
      flex: 1 1 100%;
    }

    .refresh-badge {
      font-size: 9px !important;
      padding: 3px 8px !important;
    }

    .stats-section {
      padding: 10px !important;
      gap: 8px !important;
      margin-bottom: 12px !important;
    }

    .stat-label {
      font-size: 9px !important;
    }

    .stat-value {
      font-size: 14px !important;
    }

    .empty-state {
      padding: 30px 16px !important;
    }

    .empty-icon {
      font-size: 40px !important;
    }

    .empty-text {
      font-size: 14px !important;
    }

    .empty-subtext {
      font-size: 12px !important;
    }

    .orders-container {
      margin-bottom: 16px !important;
    }

    .order-box {
      padding: 8px !important;
      margin-bottom: 6px !important;
      border-radius: 6px;
    }

    .order-number {
      font-size: 11px !important;
    }

    .order-status-badge {
      font-size: 9px !important;
      padding: 2px 6px !important;
    }

    .order-details {
      margin: 6px 0 !important;
    }

    .order-meta {
      font-size: 10px !important;
    }

    .order-total {
      font-size: 11px !important;
    }

    .items-preview {
      margin-top: 6px !important;
      padding-top: 6px !important;
      font-size: 10px !important;
    }

    .item-preview-row {
      padding: 2px 0 !important;
      font-size: 9px !important;
      gap: 6px !important;
    }

    .item-qty {
      font-size: 8px !important;
      min-width: 24px;
      padding: 1px 3px !important;
    }

    .more-items {
      margin: 4px 0 0 0 !important;
      font-size: 9px !important;
    }

    .refresh-btn {
      padding: 8px 10px !important;
      font-size: 10px !important;
      margin-bottom: 10px !important;
      min-height: 36px !important;
    }

    .buttons-container {
      gap: 8px !important;
    }

    .yellow-btn, .green-btn {
      padding: 8px 10px !important;
      font-size: 11px !important;
      min-height: 36px !important;
      gap: 4px !important;
    }

    .ready-notice {
      padding: 6px 10px !important;
      font-size: 11px !important;
    }

    .footer-info {
      margin-top: 12px !important;
    }

    .last-update {
      font-size: 9px !important;
    }
  }

  /* Extra Small Phone - Below 360px */
  @media (max-width: 359px) {
    .order-status-wrapper {
      padding: 8px;
    }

    .order-status-card {
      padding: 12px !important;
      max-width: 100%;
      border-radius: 8px;
    }

    .card-header {
      margin-bottom: 10px !important;
    }

    .heading {
      font-size: 14px !important;
    }

    .refresh-badge {
      font-size: 8px !important;
      padding: 2px 6px !important;
    }

    .stats-section {
      padding: 8px !important;
      gap: 6px !important;
      margin-bottom: 10px !important;
    }

    .stat-label {
      font-size: 8px !important;
    }

    .stat-value {
      font-size: 13px !important;
    }

    .empty-icon {
      font-size: 36px !important;
    }

    .empty-text {
      font-size: 13px !important;
    }

    .order-box {
      padding: 6px !important;
      margin-bottom: 4px !important;
      border-left-width: 3px !important;
    }

    .order-number {
      font-size: 10px !important;
    }

    .order-status-badge {
      font-size: 8px !important;
      padding: 2px 4px !important;
    }

    .order-meta {
      font-size: 9px !important;
    }

    .order-total {
      font-size: 10px !important;
    }

    .items-preview {
      font-size: 9px !important;
    }

    .item-preview-row {
      font-size: 8px !important;
      gap: 4px !important;
    }

    .refresh-btn {
      padding: 6px 8px !important;
      font-size: 9px !important;
      min-height: 32px !important;
      margin-bottom: 8px !important;
    }

    .buttons-container {
      gap: 6px !important;
    }

    .yellow-btn, .green-btn {
      padding: 6px 8px !important;
      font-size: 10px !important;
      min-height: 32px !important;
    }

    .ready-notice {
      padding: 5px 8px !important;
      font-size: 10px !important;
    }

    .last-update {
      font-size: 8px !important;
    }
  }

  /* Landscape orientation */
  @media (max-height: 600px) and (orientation: landscape) {
    .order-status-wrapper {
      padding: 12px;
      padding-top: 60px;
      padding-bottom: 60px;
    }

    .order-status-card {
      max-height: calc(100vh - 80px) !important;
      overflow-y: auto;
    }

    .orders-container {
      max-height: calc(100vh - 200px) !important;
    }

    .heading {
      font-size: 18px !important;
    }

    .yellow-btn, .green-btn {
      padding: 8px 12px !important;
      min-height: 36px !important;
    }
  }

  /* Touch device optimizations */
  @media (hover: none) and (pointer: coarse) {
    button {
      min-height: 44px;
      -webkit-tap-highlight-color: transparent;
    }

    .order-box {
      border: 1px solid #E8E8E8 !important;
    }

    .yellow-btn:active, .green-btn:active, .refresh-btn:active {
      opacity: 0.85;
    }
  }

  /* High DPI screens */
  @media (min-resolution: 2dppx) {
    .order-status-card, .error-card, .loading-card {
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
    }

    .order-box {
      border-radius: 8px;
    }
  }

  /* Prevent zoom on iPhone */
  @media (max-width: 768px) {
    button {
      font-size: 16px !important;
    }
  }

  /* Safe area support */
  @media (max-width: 639px) {
    .order-status-wrapper {
      padding-top: max(12px, env(safe-area-inset-top));
      padding-bottom: max(12px, env(safe-area-inset-bottom));
      padding-left: max(12px, env(safe-area-inset-left));
      padding-right: max(12px, env(safe-area-inset-right));
    }
  }
`;

export default OrderStatus;
