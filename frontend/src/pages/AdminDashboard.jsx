import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { io } from "socket.io-client";

function AdminDashboard() {
  const navigate = useNavigate();
  const token = localStorage.getItem("adminToken");

  const [tables, setTables] = useState([]);
  const [orders, setOrders] = useState([]);
  const [income, setIncome] = useState(0);

  const audioRef = useRef(null);

  /* ================= LOGOUT ================= */

  const handleLogout = () => {
    localStorage.removeItem("adminToken");
    navigate("/admin-login");
  };

  const handleUnauthorized = () => {
    alert("Session expired. Please login again.");
    handleLogout();
  };

  /* ================= FETCH FUNCTIONS ================= */

  const fetchTables = async () => {
    const res = await fetch("https://five0-50-chinese-fast-food-6.onrender.com/tables");
    const data = await res.json();
    setTables(data);
  };

  const fetchOrders = async () => {
    const res = await fetch("https://five0-50-chinese-fast-food-6.onrender.com/orders", {
      headers: {
        Authorization: "Bearer " + token,
      },
    });

    if (res.status === 401) {
      handleUnauthorized();
      return;
    }

    const data = await res.json();
    setOrders(data);
  };

  const fetchIncome = async () => {
    const res = await fetch("https://five0-50-chinese-fast-food-6.onrender.com/income", {
      headers: {
        Authorization: "Bearer " + token,
      },
    });

    if (res.status === 401) {
      handleUnauthorized();
      return;
    }

    const data = await res.json();
    setIncome(data.total_income);
  };

  /* ================= WEBSOCKET ================= */

  useEffect(() => {
    const socket = io("https://five0-50-chinese-fast-food-6.onrender.com");

    socket.on("new_order", () => {
      fetchOrders();
      fetchTables();
      fetchIncome();

      // 🔊 Play Sound
      if (audioRef.current) {
        audioRef.current.play().catch(() => {});
      }

      // 🔔 Desktop Notification
      if (Notification.permission === "granted") {
        new Notification("🚨 New Order Received!");
      }
    });

    socket.on("order_updated", () => {
      fetchOrders();
      fetchTables();
      fetchIncome();
    });

    return () => socket.disconnect();
  }, []);

  /* ================= DESKTOP PERMISSION ================= */

  useEffect(() => {
    if (Notification.permission !== "granted") {
      Notification.requestPermission();
    }

    fetchTables();
    fetchOrders();
    fetchIncome();
  }, []);

  /* ================= ORDER ACTIONS ================= */

  const updateOrderStatus = async (orderId, status) => {
    await fetch(`https://five0-50-chinese-fast-food-6.onrender.com/orders/${orderId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify({ status }),
    });
    fetchOrders();
  };

  const markAsPaid = async (orderId) => {
    await fetch(`https://five0-50-chinese-fast-food-6.onrender.com/orders/${orderId}/pay`, {
      method: "PUT",
      headers: {
        Authorization: "Bearer " + token,
      },
    });
    fetchOrders();
  };

  // ✅ Send WhatsApp Bill
  const sendWhatsAppBill = (order) => {
    if (audioRef.current) {
      audioRef.current.play().catch(() => {});
    }

    // Format number (remove spaces + ensure country code)
    let phone = order.whatsapp.replace(/\D/g, "");

    if (phone.length === 10) {
      phone = "91" + phone; // India default
    }

    const itemsList = order.items
      .map((item, index) => {
        return `${index + 1}. ${item.name}
   Qty: ${item.quantity} × ₹${item.price}
   Amount: ₹${item.price * item.quantity}`;
      })
      .join("\n\n");

    const time = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

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

    const encodedMessage = encodeURIComponent(message);
    const whatsappUrl = `https://wa.me/${phone}?text=${encodedMessage}`;

    window.open(whatsappUrl, "_blank");
  };

  /* ================= SORT ORDERS ================= */

  const pendingOrders = orders.filter((o) => o.status !== "paid");
  const paidOrders = orders.filter((o) => o.status === "paid");

  /* ================= UI ================= */

  return (
    <div style={styles.container}>
      <style>{mediaQueries}</style>
      <audio ref={audioRef} src="/notification.mp3" />

      {/* MAIN CONTENT */}
      <div className="main-content" style={styles.mainContent}>
        {/* KPI CARDS */}
        <div className="kpi-grid" style={styles.kpiGrid}>
          <div className="kpi-card" style={styles.kpiCard}>
            <div className="kpi-label" style={styles.kpiLabel}>
              Total Income
            </div>
            <div className="kpi-value" style={styles.kpiValue}>
              ₹ {income}
            </div>
          </div>

          <div className="kpi-card" style={styles.kpiCard}>
            <div className="kpi-label" style={styles.kpiLabel}>
              Total Orders
            </div>
            <div className="kpi-value" style={styles.kpiValue}>
              {orders.length}
            </div>
          </div>

          <div className="kpi-card" style={styles.kpiCard}>
            <div className="kpi-label" style={styles.kpiLabel}>Pending</div>
            <div
              className="kpi-value"
              style={{ ...styles.kpiValue, color: "#D32F2F" }}
            >
              {pendingOrders.length}
            </div>
          </div>

          <div className="kpi-card" style={styles.kpiCard}>
            <div className="kpi-label" style={styles.kpiLabel}>Completed</div>
            <div
              className="kpi-value"
              style={{ ...styles.kpiValue, color: "#388E3C" }}
            >
              {paidOrders.length}
            </div>
          </div>
        </div>

        {/* TABLES SECTION */}
        <div className="section" style={styles.section}>
          <div className="section-header" style={styles.sectionHeader}>
            <h2 className="section-title" style={styles.sectionTitle}>
              Table Management
            </h2>
            <span className="badge" style={styles.badge}>
              {tables.length} Tables
            </span>
          </div>
          <div className="tables-container" style={styles.tablesContainer}>
            {tables.map((t) => (
              <div
                key={t.id}
                className="table-item"
                style={{
                  ...styles.tableItem,
                  background: t.status === "free" ? "#F5F5F5" : "#FFF3E0",
                  borderLeft: `4px solid ${
                    t.status === "free" ? "#388E3C" : "#F57C00"
                  }`,
                }}
              >
                <div className="table-info" style={styles.tableInfo}>
                  <div className="table-num" style={styles.tableNum}>
                    Table {t.number}
                  </div>
                  <div
                    className="table-status"
                    style={{
                      ...styles.tableStatus,
                      color: t.status === "free" ? "#388E3C" : "#F57C00",
                    }}
                  >
                    {t.status === "free" ? "Available" : "Occupied"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* PENDING ORDERS */}
        <div className="section" style={styles.section}>
          <div className="section-header" style={styles.sectionHeader}>
            <h2 className="section-title" style={styles.sectionTitle}>
              Pending Orders
            </h2>
            <span
              className="badge badge-red"
              style={{
                ...styles.badge,
                background: "#D32F2F",
                color: "#FFF",
              }}
            >
              {pendingOrders.length}
            </span>
          </div>

          {pendingOrders.length === 0 ? (
            <div className="empty-state" style={styles.emptyState}>
              <p>No pending orders</p>
            </div>
          ) : (
            <div className="orders-list" style={styles.ordersList}>
              {pendingOrders.map((order) => (
                <div
                  key={order.id}
                  className="order-item"
                  style={styles.orderItem}
                >
                  <div
                    className="order-item-left"
                    style={styles.orderItemLeft}
                  >
                    <div className="order-header" style={styles.orderHeader}>
                      <span className="order-id" style={styles.orderId}>
                        Order #{order.id}
                      </span>
                      <span className="table-tag" style={styles.tableTag}>
                        Table {order.table_id}
                      </span>
                    </div>
                    <div className="order-meta" style={styles.orderMeta}>
                      <p
                        className="customer-name"
                        style={styles.customerName}
                      >
                        {order.customer_name}
                      </p>
                      <p
                        className="customer-phone"
                        style={styles.customerPhone}
                      >
                        {order.whatsapp}
                      </p>
                      <p className="order-status" style={styles.orderStatus}>
                        {order.status.toUpperCase()}
                      </p>
                    </div>

                    {/* ITEMS LIST */}
                    <div className="items-detail" style={styles.itemsDetail}>
                      <div className="items-label" style={styles.itemsLabel}>
                        Items:
                      </div>
                      {order.items && order.items.length > 0 ? (
                        <div className="items-grid" style={styles.itemsGrid}>
                          {order.items.map((item, idx) => (
                            <div
                              key={idx}
                              className="item-row"
                              style={styles.itemRow}
                            >
                              <span
                                className="item-qty"
                                style={styles.itemQty}
                              >
                                {item.quantity}x
                              </span>
                              <span
                                className="item-name-detail"
                                style={styles.itemNameDetail}
                              >
                                {item.name}
                              </span>
                              <span
                                className="item-price-detail"
                                style={styles.itemPriceDetail}
                              >
                                ₹{item.price * item.quantity}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p
                          style={{
                            margin: "4px 0",
                            fontSize: "12px",
                            color: "#9C9C9C",
                          }}
                        >
                          No items
                        </p>
                      )}
                    </div>
                  </div>

                  <div
                    className="order-item-right"
                    style={styles.orderItemRight}
                  >
                    <div className="amount" style={styles.amount}>
                      ₹ {order.total}
                    </div>
                    <div className="action-buttons" style={styles.actionButtons}>
                      <button
                        className="btn-primary"
                        style={styles.btnPrimary}
                        onClick={() => updateOrderStatus(order.id, "ready")}
                        onMouseEnter={(e) => (e.target.style.opacity = "0.85")}
                        onMouseLeave={(e) => (e.target.style.opacity = "1")}
                      >
                        Ready
                      </button>
                      <button
                        className="btn-whatsapp"
                        style={styles.btnWhatsapp}
                        onClick={() => sendWhatsAppBill(order)}
                        onMouseEnter={(e) => (e.target.style.opacity = "0.85")}
                        onMouseLeave={(e) => (e.target.style.opacity = "1")}
                      >
                        Send
                      </button>
                      <button
                        className="btn-secondary"
                        style={styles.btnSecondary}
                        onClick={() => markAsPaid(order.id)}
                        onMouseEnter={(e) => (e.target.style.opacity = "0.85")}
                        onMouseLeave={(e) => (e.target.style.opacity = "1")}
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

        {/* COMPLETED ORDERS */}
        <div className="section" style={styles.section}>
          <div className="section-header" style={styles.sectionHeader}>
            <h2 className="section-title" style={styles.sectionTitle}>
              Completed Orders
            </h2>
            <span
              className="badge badge-green"
              style={{
                ...styles.badge,
                background: "#388E3C",
                color: "#FFF",
              }}
            >
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
                <div
                  key={order.id}
                  className="order-item completed"
                  style={{ ...styles.orderItem, opacity: 0.7 }}
                >
                  <div
                    className="order-item-left"
                    style={styles.orderItemLeft}
                  >
                    <div className="order-header" style={styles.orderHeader}>
                      <span className="order-id" style={styles.orderId}>
                        Order #{order.id}
                      </span>
                      <span className="table-tag" style={styles.tableTag}>
                        Table {order.table_id}
                      </span>
                    </div>
                    <div className="order-meta" style={styles.orderMeta}>
                      <p
                        className="customer-name"
                        style={styles.customerName}
                      >
                        {order.customer_name}
                      </p>
                      <p
                        className="customer-phone"
                        style={styles.customerPhone}
                      >
                        {order.whatsapp}
                      </p>
                    </div>
                  </div>
                  <div className="amount" style={styles.amount}>
                    ₹ {order.total}
                  </div>
                  <div className="action-buttons" style={styles.actionButtons}>
                    <button
                      className="btn-whatsapp"
                      style={styles.btnWhatsapp}
                      onClick={() => sendWhatsAppBill(order)}
                      onMouseEnter={(e) => (e.target.style.opacity = "0.85")}
                      onMouseLeave={(e) => (e.target.style.opacity = "1")}
                    >
                      Send Bill
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
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
    width: "100%",
    boxSizing: "border-box",
    overflowX: "hidden",
  },

  navbar: {
    background: "#FFFFFF",
    borderBottom: "1px solid #E8E8E8",
    padding: "0",
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
    transition: "all 0.2s ease",
    opacity: "1",
    minHeight: "40px",
    whiteSpace: "nowrap",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },

  mainContent: {
    maxWidth: "1400px",
    margin: "0 auto",
    padding: "20px 16px",
    width: "100%",
    boxSizing: "border-box",
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
    boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
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
    boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
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
    flex: "1 1 auto",
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
    transition: "all 0.2s ease",
    boxSizing: "border-box",
  },

  tableInfo: {
    textAlign: "center",
  },

  tableNum: {
    fontSize: "16px",
    fontWeight: "600",
    color: "#1C1C1C",
    marginBottom: "4px",
  },

  tableStatus: {
    fontSize: "12px",
    fontWeight: "500",
  },

  emptyState: {
    padding: "40px 20px",
    textAlign: "center",
    color: "#9C9C9C",
    fontSize: "14px",
    background: "#FAFAFA",
    borderRadius: "4px",
  },

  ordersList: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    width: "100%",
  },

  orderItem: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "stretch",
    padding: "16px",
    background: "#FAFAFA",
    borderRadius: "4px",
    border: "1px solid #F0F0F0",
    transition: "all 0.2s ease",
    gap: "16px",
    flexWrap: "wrap",
    width: "100%",
    boxSizing: "border-box",
  },

  orderItemLeft: {
    flex: "1 1 100%",
    minWidth: "200px",
  },

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
    gap: "12px",
    marginBottom: "8px",
    flexWrap: "wrap",
  },

  orderId: {
    fontSize: "14px",
    fontWeight: "600",
    color: "#1C1C1C",
  },

  tableTag: {
    background: "#E8E8E8",
    color: "#636363",
    padding: "3px 8px",
    borderRadius: "3px",
    fontSize: "11px",
    fontWeight: "500",
    whiteSpace: "nowrap",
  },

  orderMeta: {
    display: "flex",
    gap: "16px",
    fontSize: "13px",
    flexWrap: "wrap",
    marginBottom: "8px",
  },

  customerName: {
    margin: 0,
    color: "#636363",
    fontWeight: "500",
    whiteSpace: "nowrap",
  },

  customerPhone: {
    margin: 0,
    color: "#9C9C9C",
    fontSize: "12px",
    whiteSpace: "nowrap",
  },

  orderStatus: {
    margin: 0,
    color: "#9C9C9C",
    fontSize: "12px",
    textTransform: "uppercase",
    whiteSpace: "nowrap",
  },

  itemsDetail: {
    marginTop: "12px",
    paddingTop: "12px",
    borderTop: "1px solid #E8E8E8",
  },

  itemsLabel: {
    fontSize: "11px",
    fontWeight: "600",
    color: "#1C1C1C",
    textTransform: "uppercase",
    marginBottom: "6px",
  },

  itemsGrid: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },

  itemRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    fontSize: "12px",
  },

  itemQty: {
    background: "#F0F0F0",
    color: "#636363",
    padding: "2px 6px",
    borderRadius: "2px",
    fontWeight: "600",
    minWidth: "30px",
    textAlign: "center",
  },

  itemNameDetail: {
    color: "#636363",
    flex: "1 1 auto",
    minWidth: "0",
  },

  itemPriceDetail: {
    color: "#1C1C1C",
    fontWeight: "600",
    whiteSpace: "nowrap",
  },

  amount: {
    fontSize: "18px",
    fontWeight: "600",
    color: "#1C1C1C",
    minWidth: "70px",
    textAlign: "right",
    whiteSpace: "nowrap",
  },

  actionButtons: {
    display: "flex",
    gap: "6px",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    flex: "1 1 auto",
    minWidth: "200px",
  },

  btnPrimary: {
    background: "#388E3C",
    color: "#FFFFFF",
    border: "none",
    padding: "6px 12px",
    borderRadius: "4px",
    cursor: "pointer",
    fontSize: "12px",
    fontWeight: "500",
    transition: "all 0.2s ease",
    opacity: "1",
    whiteSpace: "nowrap",
    minHeight: "36px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },

  btnWhatsapp: {
    background: "#25D366",
    color: "#FFFFFF",
    border: "none",
    padding: "6px 12px",
    borderRadius: "4px",
    cursor: "pointer",
    fontSize: "12px",
    fontWeight: "500",
    transition: "all 0.2s ease",
    opacity: "1",
    whiteSpace: "nowrap",
    minHeight: "36px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },

  btnSecondary: {
    background: "#F57C00",
    color: "#FFFFFF",
    border: "none",
    padding: "6px 12px",
    borderRadius: "4px",
    cursor: "pointer",
    fontSize: "12px",
    fontWeight: "500",
    transition: "all 0.2s ease",
    opacity: "1",
    whiteSpace: "nowrap",
    minHeight: "36px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
};

/* ================= MEDIA QUERIES ================= */

const mediaQueries = `
  * {
    box-sizing: border-box;
  }

  /* Desktop - 1024px and above */
  @media (min-width: 1024px) {
    .admin-navbar {
      padding: 18px 30px;
    }

    .main-content {
      padding: 30px;
    }

    .kpi-grid {
      grid-template-columns: repeat(4, 1fr) !important;
    }

    .order-item {
      flex-wrap: nowrap !important;
    }

    .order-item-right {
      flex: 0 0 auto !important;
      min-width: auto !important;
      justify-content: flex-end;
    }

    .action-buttons {
      justify-content: flex-end !important;
      flex-wrap: nowrap !important;
    }
  }

  /* Tablet - 768px to 1023px */
  @media (max-width: 1023px) and (min-width: 768px) {
    .admin-navbar {
      padding: 14px 20px;
    }

    .nav-content {
      padding: 14px 20px !important;
    }

    .admin-logo {
      font-size: 18px !important;
    }

    .logout-btn {
      padding: 6px 14px !important;
      font-size: 12px !important;
    }

    .main-content {
      padding: 20px;
    }

    .kpi-grid {
      grid-template-columns: repeat(2, 1fr) !important;
      gap: 12px !important;
    }

    .kpi-card {
      padding: 16px 20px !important;
    }

    .section {
      padding: 16px !important;
      margin-bottom: 16px !important;
    }

    .section-title {
      font-size: 15px !important;
    }

    .tables-container {
      grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)) !important;
    }

    .order-item {
      flex-direction: column !important;
      align-items: stretch !important;
    }

    .order-item-right {
      flex: 1 1 100% !important;
      min-width: auto !important;
    }

    .action-buttons {
      justify-content: space-between !important;
      flex-wrap: wrap !important;
    }

    .btn-primary, .btn-whatsapp, .btn-secondary {
      flex: 1 1 calc(33.333% - 4px) !important;
      padding: 8px 8px !important;
      font-size: 11px !important;
      min-height: 36px !important;
    }

    .amount {
      width: 100% !important;
      text-align: left !important;
      margin-bottom: 12px !important;
    }
  }

  /* Large Phone - 640px to 767px */
  @media (max-width: 767px) and (min-width: 640px) {
    .admin-navbar {
      padding: 12px 14px;
    }

    .nav-content {
      padding: 12px 14px !important;
      gap: 8px !important;
    }

    .admin-logo {
      font-size: 16px !important;
    }

    .logout-btn {
      padding: 6px 12px !important;
      font-size: 11px !important;
    }

    .main-content {
      padding: 16px 12px;
    }

    .kpi-grid {
      grid-template-columns: repeat(2, 1fr) !important;
      gap: 10px !important;
    }

    .kpi-card {
      padding: 14px 16px !important;
    }

    .kpi-label {
      font-size: 11px !important;
    }

    .kpi-value {
      font-size: 24px !important;
    }

    .section {
      padding: 14px !important;
      margin-bottom: 14px !important;
    }

    .section-header {
      margin-bottom: 14px !important;
      padding-bottom: 10px !important;
    }

    .section-title {
      font-size: 14px !important;
    }

    .badge {
      font-size: 11px !important;
      padding: 3px 8px !important;
    }

    .tables-container {
      grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)) !important;
      gap: 10px !important;
    }

    .table-num {
      font-size: 14px !important;
    }

    .order-item {
      flex-direction: column !important;
      align-items: stretch !important;
      padding: 12px !important;
      gap: 10px !important;
    }

    .order-id {
      font-size: 13px !important;
    }

    .order-meta {
      gap: 8px !important;
      font-size: 11px !important;
    }

    .customer-name {
      font-size: 12px !important;
    }

    .customer-phone {
      font-size: 10px !important;
    }

    .items-detail {
      margin-top: 10px !important;
      padding-top: 10px !important;
    }

    .items-label {
      font-size: 10px !important;
    }

    .item-row {
      font-size: 11px !important;
      gap: 6px !important;
    }

    .item-qty {
      font-size: 10px !important;
      min-width: 28px;
      padding: 1px 4px !important;
    }

    .item-nameDetail {
      font-size: 11px !important;
    }

    .item-price-detail {
      font-size: 11px !important;
    }

    .amount {
      width: 100% !important;
      text-align: left !important;
      font-size: 16px !important;
      margin-bottom: 10px !important;
    }

    .action-buttons {
      width: 100% !important;
      gap: 8px !important;
    }

    .btn-primary, .btn-whatsapp, .btn-secondary {
      flex: 1 1 calc(33.333% - 5px) !important;
      padding: 6px 6px !important;
      font-size: 10px !important;
      min-height: 34px !important;
    }
  }

  /* Phone - 480px to 639px */
  @media (max-width: 639px) and (min-width: 480px) {
    .admin-navbar {
      padding: 10px 12px;
    }

    .nav-content {
      padding: 10px 12px !important;
      gap: 6px !important;
    }

    .admin-logo {
      font-size: 14px !important;
    }

    .logout-btn {
      padding: 5px 10px !important;
      font-size: 10px !important;
    }

    .main-content {
      padding: 12px 10px;
    }

    .kpi-grid {
      grid-template-columns: repeat(2, 1fr) !important;
      gap: 8px !important;
    }

    .kpi-card {
      padding: 12px 14px !important;
    }

    .kpi-label {
      font-size: 10px !important;
    }

    .kpi-value {
      font-size: 20px !important;
    }

    .section {
      padding: 12px !important;
      margin-bottom: 12px !important;
    }

    .section-header {
      margin-bottom: 12px !important;
      padding-bottom: 8px !important;
      gap: 6px !important;
    }

    .section-title {
      font-size: 13px !important;
    }

    .badge {
      font-size: 10px !important;
      padding: 2px 6px !important;
    }

    .tables-container {
      grid-template-columns: repeat(auto-fill, minmax(80px, 1fr)) !important;
      gap: 8px !important;
    }

    .table-item {
      padding: 12px !important;
    }

    .table-num {
      font-size: 13px !important;
    }

    .table-status {
      font-size: 10px !important;
    }

    .order-item {
      flex-direction: column !important;
      align-items: stretch !important;
      padding: 10px !important;
      gap: 8px !important;
    }

    .order-header {
      gap: 8px !important;
      margin-bottom: 6px !important;
    }

    .order-id {
      font-size: 12px !important;
    }

    .table-tag {
      font-size: 10px !important;
      padding: 2px 6px !important;
    }

    .order-meta {
      gap: 6px !important;
      font-size: 10px !important;
    }

    .customer-name {
      font-size: 11px !important;
    }

    .customer-phone {
      font-size: 9px !important;
    }

    .items-detail {
      margin-top: 8px !important;
      padding-top: 8px !important;
    }

    .items-label {
      font-size: 9px !important;
      margin-bottom: 4px !important;
    }

    .item-row {
      font-size: 10px !important;
      gap: 4px !important;
    }

    .item-qty {
      font-size: 9px !important;
      min-width: 26px;
      padding: 1px 3px !important;
    }

    .amount {
      width: 100% !important;
      text-align: left !important;
      font-size: 15px !important;
      margin-bottom: 8px !important;
    }

    .action-buttons {
      width: 100% !important;
      gap: 6px !important;
    }

    .btn-primary, .btn-whatsapp, .btn-secondary {
      flex: 1 1 calc(33.333% - 4px) !important;
      padding: 5px 4px !important;
      font-size: 9px !important;
      min-height: 32px !important;
    }
  }

  /* Small Phone - 360px to 479px */
  @media (max-width: 479px) and (min-width: 360px) {
    .admin-navbar {
      padding: 8px 10px;
    }

    .nav-content {
      padding: 8px 10px !important;
      gap: 4px !important;
      flex-wrap: wrap;
    }

    .admin-logo {
      font-size: 13px !important;
      margin: 0 !important;
      flex: 1 1 100%;
    }

    .logout-btn {
      padding: 4px 8px !important;
      font-size: 9px !important;
      width: 100%;
    }

    .main-content {
      padding: 10px 8px;
    }

    .kpi-grid {
      grid-template-columns: repeat(2, 1fr) !important;
      gap: 6px !important;
    }

    .kpi-card {
      padding: 10px 12px !important;
    }

    .kpi-label {
      font-size: 9px !important;
      margin-bottom: 4px !important;
    }

    .kpi-value {
      font-size: 18px !important;
    }

    .section {
      padding: 10px !important;
      margin-bottom: 10px !important;
    }

    .section-header {
      margin-bottom: 10px !important;
      padding-bottom: 6px !important;
      gap: 4px !important;
    }

    .section-title {
      font-size: 12px !important;
    }

    .badge {
      font-size: 9px !important;
      padding: 2px 4px !important;
    }

    .tables-container {
      grid-template-columns: repeat(auto-fill, minmax(70px, 1fr)) !important;
      gap: 6px !important;
    }

    .table-item {
      padding: 10px !important;
      border-left-width: 3px !important;
    }

    .table-num {
      font-size: 12px !important;
      margin-bottom: 2px !important;
    }

    .table-status {
      font-size: 9px !important;
    }

    .order-item {
      flex-direction: column !important;
      align-items: stretch !important;
      padding: 8px !important;
      gap: 6px !important;
    }

    .order-header {
      gap: 6px !important;
      margin-bottom: 4px !important;
      flex-wrap: wrap;
    }

    .order-id {
      font-size: 11px !important;
    }

    .table-tag {
      font-size: 9px !important;
      padding: 1px 4px !important;
    }

    .order-meta {
      gap: 4px !important;
      font-size: 9px !important;
      flex-wrap: wrap;
    }

    .customer-name {
      font-size: 10px !important;
      margin: 0 !important;
    }

    .customer-phone {
      font-size: 8px !important;
      margin: 0 !important;
    }

    .items-detail {
      margin-top: 6px !important;
      padding-top: 6px !important;
    }

    .items-label {
      font-size: 8px !important;
      margin-bottom: 3px !important;
    }

    .item-row {
      font-size: 9px !important;
      gap: 3px !important;
    }

    .item-qty {
      font-size: 8px !important;
      min-width: 24px;
      padding: 0 2px !important;
    }

    .item-name-detail {
      font-size: 9px !important;
    }

    .item-price-detail {
      font-size: 9px !important;
    }

    .amount {
      width: 100% !important;
      text-align: left !important;
      font-size: 14px !important;
      margin-bottom: 6px !important;
    }

    .action-buttons {
      width: 100% !important;
      gap: 4px !important;
    }

    .btn-primary, .btn-whatsapp, .btn-secondary {
      flex: 1 1 calc(33.333% - 3px) !important;
      padding: 4px 2px !important;
      font-size: 8px !important;
      min-height: 30px !important;
    }
  }

  /* Extra Small Phone - Below 360px */
  @media (max-width: 359px) {
    .admin-navbar {
      padding: 6px 8px;
    }

    .nav-content {
      padding: 6px 8px !important;
      flex-direction: column;
      gap: 4px !important;
    }

    .admin-logo {
      font-size: 12px !important;
      margin: 0 !important;
    }

    .logout-btn {
      padding: 4px 6px !important;
      font-size: 8px !important;
      width: 100%;
    }

    .main-content {
      padding: 8px 6px;
    }

    .kpi-grid {
      grid-template-columns: repeat(2, 1fr) !important;
      gap: 4px !important;
    }

    .kpi-card {
      padding: 8px 10px !important;
    }

    .kpi-label {
      font-size: 8px !important;
      margin-bottom: 2px !important;
    }

    .kpi-value {
      font-size: 16px !important;
    }

    .section {
      padding: 8px !important;
      margin-bottom: 8px !important;
    }

    .section-title {
      font-size: 11px !important;
    }

    .badge {
      font-size: 8px !important;
      padding: 1px 3px !important;
    }

    .tables-container {
      grid-template-columns: repeat(auto-fill, minmax(60px, 1fr)) !important;
      gap: 4px !important;
    }

    .table-item {
      padding: 8px !important;
    }

    .table-num {
      font-size: 11px !important;
    }

    .order-item {
      padding: 6px !important;
      gap: 4px !important;
    }

    .order-id {
      font-size: 10px !important;
    }

    .order-meta {
      font-size: 8px !important;
    }

    .customer-name {
      font-size: 9px !important;
    }

    .items-label {
      font-size: 7px !important;
    }

    .item-row {
      font-size: 8px !important;
    }

    .amount {
      font-size: 13px !important;
      margin-bottom: 4px !important;
    }

    .action-buttons {
      gap: 2px !important;
    }

    .btn-primary, .btn-whatsapp, .btn-secondary {
      flex: 1 1 calc(33.333% - 2px) !important;
      padding: 3px 1px !important;
      font-size: 7px !important;
      min-height: 28px !important;
    }
  }

  /* Landscape orientation */
  @media (max-height: 600px) and (orientation: landscape) {
    .admin-navbar {
      padding: 6px 12px;
    }

    .main-content {
      padding: 12px;
    }

    .section {
      margin-bottom: 10px !important;
      padding: 12px !important;
    }

    .kpi-grid {
      gap: 8px !important;
      margin-bottom: 12px !important;
    }
  }

  /* Touch device optimizations */
  @media (hover: none) and (pointer: coarse) {
    button {
      min-height: 44px;
      -webkit-tap-highlight-color: transparent;
    }

    .btn-primary, .btn-whatsapp, .btn-secondary {
      min-height: 40px !important;
    }
  }

  /* High DPI screens */
  @media (min-resolution: 2dppx) {
    .section, .kpi-card {
      border-radius: 6px;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
    }
  }

  /* Safe area support */
  @media (max-width: 639px) {
    .admin-navbar {
      padding-top: max(8px, env(safe-area-inset-top));
      padding-left: max(8px, env(safe-area-inset-left));
      padding-right: max(8px, env(safe-area-inset-right));
    }

    .main-content {
      padding-left: max(8px, env(safe-area-inset-left));
      padding-right: max(8px, env(safe-area-inset-right));
    }
  }
`;

export default AdminDashboard;
