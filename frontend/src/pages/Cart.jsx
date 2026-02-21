import { useHotel } from "../context/HotelContext";
import { useNavigate } from "react-router-dom";
import { useState } from "react";

function Cart() {
  const {
    cart,
    updateQuantity,
    customerInfo,
    setCustomerInfo,
    placeOrder,
  } = useHotel();

  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [successMessage, setSuccessMessage] = useState("");

  const total = cart.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );

  // ✅ Enhanced validation with detailed error messages
  const validateForm = () => {
    const newErrors = {};

    if (!customerInfo.name || !customerInfo.name.trim()) {
      newErrors.name = "Name is required";
    } else if (customerInfo.name.trim().length < 2) {
      newErrors.name = "Name must be at least 2 characters";
    }

    if (!customerInfo.whatsapp || !customerInfo.whatsapp.trim()) {
      newErrors.whatsapp = "WhatsApp number is required";
    } else if (customerInfo.whatsapp.length !== 10) {
      newErrors.whatsapp = "WhatsApp number must be 10 digits";
    } else if (!/^\d+$/.test(customerInfo.whatsapp)) {
      newErrors.whatsapp = "WhatsApp number must contain only digits";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // ✅ Handle order placement with better error handling
  const handleConfirm = async () => {
    // Validate cart
    if (cart.length === 0) {
      setErrors({ cart: "Your cart is empty" });
      return;
    }

    // Validate form
    if (!validateForm()) {
      return;
    }

    try {
      setLoading(true);
      setErrors({});
      await placeOrder();
      setSuccessMessage("✓ Order placed successfully!");
      setTimeout(() => {
        navigate("/status");
      }, 1000);
    } catch (err) {
      console.error("Order failed:", err);
      setErrors({ submit: "Failed to place order. Please try again." });
      setLoading(false);
    }
  };

  // ✅ Handle input changes with real-time validation
  const handleNameChange = (value) => {
    setCustomerInfo((prev) => ({
      ...prev,
      name: value,
    }));
    if (errors.name) {
      setErrors((prev) => ({ ...prev, name: "" }));
    }
  };

  const handlePhoneChange = (value) => {
    // Only allow digits
    const digitsOnly = value.replace(/\D/g, "").slice(0, 10);
    setCustomerInfo((prev) => ({
      ...prev,
      whatsapp: digitsOnly,
    }));
    if (errors.whatsapp) {
      setErrors((prev) => ({ ...prev, whatsapp: "" }));
    }
  };

  return (
    <div className="cart-wrapper" style={styles.container}>
      <style>{mediaQueries}</style>


      {/* MAIN CONTENT */}
      <div className="main-content" style={styles.mainContent}>
        {cart.length === 0 ? (
          <div className="empty-cart" style={styles.emptyCart}>
            <div className="empty-icon" style={styles.emptyIcon}>🛒</div>
            <p className="empty-text" style={styles.emptyText}>Your cart is empty</p>
            <p className="empty-subtext" style={styles.emptySubtext}>Add items from the menu to get started</p>
            <button
              className="browse-menu-btn"
              style={styles.browseBtnEmpty}
              onClick={() => navigate("/menu")}
            >
              Browse Menu
            </button>
          </div>
        ) : (
          <div className="layout" style={styles.layout}>
            {/* CART ITEMS */}
            <div className="cart-section" style={styles.cartSection}>
              <h2 className="section-title" style={styles.sectionTitle}>
                Order Details ({cart.length} {cart.length === 1 ? "item" : "items"})
              </h2>
              
              <div className="items-list" style={styles.itemsList}>
                {cart.map((item) => (
                  <div key={item.id} className="cart-item" style={styles.cartItem}>
                    <div className="item-info" style={styles.itemInfo}>
                      <h3 className="item-name" style={styles.itemName}>{item.name}</h3>
                      <p className="item-price" style={styles.itemPrice}>₹{item.price} per unit</p>
                    </div>

                    <div className="qty-box" style={styles.qtyBox}>
                      <button
                        className="qty-btn"
                        style={styles.qtyBtn}
                        onClick={() => updateQuantity(item.id, "decrease")}
                        aria-label="Decrease quantity"
                        title="Decrease quantity"
                      >
                        −
                      </button>
                      <span className="qty-value" style={styles.qtyValue}>{item.quantity}</span>
                      <button
                        className="qty-btn"
                        style={styles.qtyBtn}
                        onClick={() => updateQuantity(item.id, "increase")}
                        aria-label="Increase quantity"
                        title="Increase quantity"
                      >
                        +
                      </button>
                    </div>

                    <div className="item-total" style={styles.itemTotal}>
                      ₹{item.price * item.quantity}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* BILLING & CHECKOUT */}
            <div className="checkout-section" style={styles.checkoutSection}>
              <h2 className="section-title" style={styles.sectionTitle}>Billing</h2>

              {/* BILL SUMMARY */}
              <div className="bill-summary" style={styles.billSummary}>
                <div className="bill-row" style={styles.billRow}>
                  <span className="bill-label" style={styles.billLabel}>Subtotal</span>
                  <span className="bill-value" style={styles.billValue}>₹{total}</span>
                </div>
                <div className="bill-row" style={styles.billRow}>
                  <span className="bill-label" style={styles.billLabel}>Tax (0%)</span>
                  <span className="bill-value" style={styles.billValue}>₹0</span>
                </div>
                <div className="bill-row-total" style={{...styles.billRow, ...styles.billRowTotal}}>
                  <span className="bill-label" style={styles.billLabel}>Total</span>
                  <span className="bill-value" style={styles.billValue}>₹{total}</span>
                </div>
              </div>

              {/* CUSTOMER INFO */}
              <h3 className="customer-title" style={styles.customerTitle}>Customer Information</h3>

              {/* ERROR MESSAGE */}
              {errors.submit && (
                <div className="error-message" style={styles.errorMessage}>
                  ⚠️ {errors.submit}
                </div>
              )}

              {/* FULL NAME INPUT */}
              <div className="input-group" style={styles.inputGroup}>
                <label className="label" style={styles.label}>
                  Full Name <span style={styles.required}>*</span>
                </label>
                <input
                  type="text"
                  placeholder="Enter your name"
                  value={customerInfo.name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  className="input"
                  style={{
                    ...styles.input,
                    borderColor: errors.name ? "#EF4F5F" : "#E8E8E8",
                    backgroundColor: errors.name ? "#FFF5F5" : "#FFFFFF",
                  }}
                  aria-invalid={!!errors.name}
                />
                {errors.name && (
                  <p className="error-text" style={styles.errorText}>
                    {errors.name}
                  </p>
                )}
              </div>

              {/* WHATSAPP INPUT */}
              <div className="input-group" style={styles.inputGroup}>
                <label className="label" style={styles.label}>
                  WhatsApp Number <span style={styles.required}>*</span>
                </label>
                <div style={styles.phoneInputWrapper}>
                  <span style={styles.countryCode}>+91</span>
                  <input
                    type="tel"
                    placeholder="Enter 10-digit number"
                    value={customerInfo.whatsapp}
                    onChange={(e) => handlePhoneChange(e.target.value)}
                    className="input"
                    style={{
                      ...styles.phoneInput,
                      borderColor: errors.whatsapp ? "#EF4F5F" : "#E8E8E8",
                      backgroundColor: errors.whatsapp ? "#FFF5F5" : "#FFFFFF",
                    }}
                    maxLength="10"
                    inputMode="numeric"
                    aria-invalid={!!errors.whatsapp}
                  />
                </div>
                {errors.whatsapp && (
                  <p className="error-text" style={styles.errorText}>
                    {errors.whatsapp}
                  </p>
                )}
                <p className="input-hint" style={styles.inputHint}>
                  {customerInfo.whatsapp.length}/10 digits entered
                </p>
              </div>

              {/* SUCCESS MESSAGE */}
              {successMessage && (
                <div className="success-message" style={styles.successMessage}>
                  {successMessage}
                </div>
              )}

              {/* PLACE ORDER BUTTON */}
              <button
                className="confirm-btn"
                style={{
                  ...styles.confirmBtn,
                  opacity: loading ? 0.7 : 1,
                  cursor: loading ? "not-allowed" : "pointer",
                }}
                onClick={handleConfirm}
                disabled={loading || cart.length === 0}
                title={cart.length === 0 ? "Add items to place order" : "Place your order"}
              >
                {loading ? (
                  <>
                    <span className="spinner" style={styles.spinner}></span>
                    Placing Order...
                  </>
                ) : (
                  <>
                    <span style={styles.checkmark}>✓</span>
                    Place Order - ₹{total}
                  </>
                )}
              </button>

              {/* FORM HINT */}
              <p className="form-hint" style={styles.formHint}>
                💳 Order will be confirmed via WhatsApp
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  container: {
    background: "#F8F8F8",
    minHeight: "100vh",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    width: "100%",
    boxSizing: "border-box",
    overflowX: "hidden",
  },

  header: {
    background: "#FFFFFF",
    borderBottom: "1px solid #E8E8E8",
    boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
    width: "100%",
    padding: "16px",
    boxSizing: "border-box",
  },

  headerTitle: {
    margin: 0,
    fontSize: "20px",
    fontWeight: "600",
    color: "#1C1C1C",
  },

  continueShoppingBtn: {
    background: "#E8E8E8",
    color: "#1C1C1C",
    border: "none",
    padding: "8px 18px",
    borderRadius: "4px",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: "500",
    transition: "all 0.2s ease",
    whiteSpace: "nowrap",
    minHeight: "40px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  },

  mainContent: {
    maxWidth: "1400px",
    margin: "0 auto",
    padding: "30px 16px",
    width: "100%",
    boxSizing: "border-box",
  },

  emptyCart: {
    background: "#FFFFFF",
    borderRadius: "8px",
    padding: "60px 40px",
    textAlign: "center",
    boxSizing: "border-box",
  },

  emptyIcon: {
    fontSize: "64px",
    marginBottom: "20px",
    opacity: 0.6,
  },

  emptyText: {
    fontSize: "18px",
    fontWeight: "600",
    color: "#1C1C1C",
    margin: "0 0 8px 0",
  },

  emptySubtext: {
    fontSize: "14px",
    color: "#9C9C9C",
    margin: "0 0 30px 0",
  },

  browseBtnEmpty: {
    background: "#FFD700",
    color: "#1C1C1C",
    border: "none",
    padding: "12px 32px",
    borderRadius: "4px",
    cursor: "pointer",
    fontWeight: "600",
    fontSize: "14px",
    transition: "all 0.2s ease",
    minHeight: "44px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  },

  layout: {
    display: "grid",
    gridTemplateColumns: "1fr 350px",
    gap: "30px",
    width: "100%",
  },

  cartSection: {
    background: "#FFFFFF",
    borderRadius: "8px",
    padding: "24px",
    border: "1px solid #E8E8E8",
    boxSizing: "border-box",
  },

  checkoutSection: {
    background: "#FFFFFF",
    borderRadius: "8px",
    padding: "24px",
    border: "1px solid #E8E8E8",
    position: "sticky",
    top: "80px",
    height: "fit-content",
    boxSizing: "border-box",
  },

  sectionTitle: {
    fontSize: "16px",
    fontWeight: "700",
    color: "#1C1C1C",
    margin: "0 0 20px 0",
    paddingBottom: "12px",
    borderBottom: "1px solid #F0F0F0",
  },

  itemsList: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    width: "100%",
  },

  cartItem: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "16px",
    background: "#F8F8F8",
    borderRadius: "6px",
    border: "1px solid #F0F0F0",
    flexWrap: "wrap",
    gap: "12px",
    width: "100%",
    boxSizing: "border-box",
  },

  itemInfo: {
    flex: "1 1 auto",
    minWidth: "140px",
  },

  itemName: {
    fontSize: "14px",
    fontWeight: "600",
    color: "#1C1C1C",
    margin: "0 0 4px 0",
    wordWrap: "break-word",
  },

  itemPrice: {
    fontSize: "12px",
    color: "#9C9C9C",
    margin: 0,
  },

  qtyBox: {
    display: "flex",
    gap: "8px",
    alignItems: "center",
    background: "#FFFFFF",
    padding: "4px 8px",
    borderRadius: "4px",
    border: "1px solid #E8E8E8",
    flexShrink: 0,
  },

  qtyBtn: {
    background: "transparent",
    border: "none",
    width: "24px",
    height: "24px",
    fontSize: "14px",
    fontWeight: "700",
    cursor: "pointer",
    color: "#FFD700",
    transition: "all 0.2s ease",
    padding: 0,
    minHeight: "40px",
    minWidth: "40px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },

  qtyValue: {
    fontSize: "13px",
    fontWeight: "600",
    minWidth: "20px",
    textAlign: "center",
  },

  itemTotal: {
    fontSize: "14px",
    fontWeight: "700",
    color: "#FFD700",
    minWidth: "70px",
    textAlign: "right",
    flexShrink: 0,
  },

  billSummary: {
    background: "#F8F8F8",
    padding: "16px",
    borderRadius: "6px",
    marginBottom: "20px",
    border: "1px solid #F0F0F0",
  },

  billRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "8px 0",
    fontSize: "13px",
  },

  billRowTotal: {
    borderTop: "2px solid #FFD700",
    paddingTop: "12px",
    marginTop: "8px",
    fontWeight: "700",
  },

  billLabel: {
    color: "#636363",
  },

  billValue: {
    fontWeight: "600",
    color: "#1C1C1C",
  },

  customerTitle: {
    fontSize: "13px",
    fontWeight: "700",
    color: "#1C1C1C",
    margin: "0 0 16px 0",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
  },

  errorMessage: {
    background: "#FFF5F5",
    border: "1px solid #EF4F5F",
    color: "#EF4F5F",
    padding: "10px 12px",
    borderRadius: "4px",
    fontSize: "12px",
    fontWeight: "600",
    marginBottom: "16px",
  },

  inputGroup: {
    marginBottom: "16px",
  },

  label: {
    display: "block",
    fontSize: "12px",
    fontWeight: "600",
    color: "#636363",
    marginBottom: "6px",
    textTransform: "uppercase",
    letterSpacing: "0.4px",
  },

  required: {
    color: "#EF4F5F",
    marginLeft: "2px",
  },

  input: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: "4px",
    border: "1px solid #E8E8E8",
    fontSize: "13px",
    boxSizing: "border-box",
    transition: "all 0.2s ease",
    fontFamily: "inherit",
    minHeight: "40px",
  },

  phoneInputWrapper: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },

  countryCode: {
    fontSize: "13px",
    fontWeight: "600",
    color: "#636363",
    minWidth: "30px",
  },

  phoneInput: {
    flex: "1 1 auto",
    padding: "10px 12px",
    borderRadius: "4px",
    border: "1px solid #E8E8E8",
    fontSize: "13px",
    boxSizing: "border-box",
    transition: "all 0.2s ease",
    fontFamily: "inherit",
    minHeight: "40px",
  },

  errorText: {
    color: "#EF4F5F",
    fontSize: "11px",
    fontWeight: "600",
    margin: "4px 0 0 0",
  },

  inputHint: {
    color: "#9C9C9C",
    fontSize: "11px",
    margin: "4px 0 0 0",
  },

  successMessage: {
    background: "#E8F5E9",
    border: "1px solid #4CAF50",
    color: "#2E7D32",
    padding: "10px 12px",
    borderRadius: "4px",
    fontSize: "12px",
    fontWeight: "600",
    marginBottom: "16px",
    textAlign: "center",
  },

  confirmBtn: {
    width: "100%",
    background: "#FFD700",
    color: "#1C1C1C",
    border: "none",
    padding: "12px",
    borderRadius: "4px",
    cursor: "pointer",
    fontWeight: "700",
    fontSize: "13px",
    transition: "all 0.2s ease",
    marginTop: "20px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    boxSizing: "border-box",
    minHeight: "48px",
  },

  checkmark: {
    fontSize: "16px",
  },

  spinner: {
    width: "12px",
    height: "12px",
    border: "2px solid #1C1C1C",
    borderTop: "2px solid transparent",
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
  },

  formHint: {
    fontSize: "11px",
    color: "#9C9C9C",
    textAlign: "center",
    margin: "12px 0 0 0",
  },
};

/* ================= MEDIA QUERIES ================= */

const mediaQueries = `
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  * {
    box-sizing: border-box;
  }

  /* Desktop - 1024px and above */
  @media (min-width: 1024px) {
    .cart-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 18px 30px !important;
      gap: 20px;
    }

    .header-title {
      margin: 0 !important;
      flex: 1;
    }

    .continue-shopping-btn {
      flex-shrink: 0;
    }

    .main-content {
      padding: 40px 30px;
    }

    .layout {
      gap: 40px;
    }
  }

  /* Tablet - 768px to 1023px */
  @media (max-width: 1023px) and (min-width: 768px) {
    .cart-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 14px 20px !important;
      gap: 12px;
    }

    .header-title {
      font-size: 18px !important;
      margin: 0 !important;
    }

    .continue-shopping-btn {
      padding: 6px 14px !important;
      font-size: 12px !important;
    }

    .main-content {
      padding: 24px 20px;
    }

    .layout {
      grid-template-columns: 1fr !important;
      gap: 20px !important;
    }

    .checkout-section {
      position: static !important;
      top: auto !important;
    }

    .cart-section {
      padding: 20px !important;
    }

    .section-title {
      font-size: 15px !important;
      margin-bottom: 16px !important;
    }

    .cart-item {
      padding: 14px !important;
      gap: 10px !important;
    }

    .item-name {
      font-size: 13px !important;
    }

    .item-price {
      font-size: 11px !important;
    }

    .item-total {
      font-size: 13px !important;
      min-width: 60px;
    }

    .qty-box {
      gap: 6px !important;
      padding: 3px 6px !important;
    }

    .qty-value {
      font-size: 12px !important;
    }

    .bill-summary {
      padding: 12px !important;
      margin-bottom: 16px !important;
    }

    .bill-row {
      padding: 6px 0 !important;
      font-size: 12px !important;
    }

    .customer-title {
      font-size: 12px !important;
      margin-bottom: 12px !important;
    }

    .input-group {
      margin-bottom: 12px !important;
    }

    .label {
      font-size: 11px !important;
      margin-bottom: 4px !important;
    }

    .input {
      padding: 8px 10px !important;
      font-size: 12px !important;
    }

    .confirm-btn {
      padding: 10px 12px !important;
      font-size: 12px !important;
      margin-top: 16px !important;
    }
  }

  /* Large Phone - 640px to 767px */
  @media (max-width: 767px) and (min-width: 640px) {
    .cart-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 14px !important;
      gap: 8px;
    }

    .header-title {
      font-size: 16px !important;
      margin: 0 !important;
    }

    .continue-shopping-btn {
      padding: 6px 12px !important;
      font-size: 11px !important;
    }

    .main-content {
      padding: 20px 12px;
    }

    .layout {
      grid-template-columns: 1fr !important;
      gap: 16px !important;
    }

    .checkout-section {
      position: static !important;
      padding: 18px !important;
    }

    .cart-section {
      padding: 18px !important;
    }

    .section-title {
      font-size: 14px !important;
      margin-bottom: 14px !important;
    }

    .cart-item {
      padding: 12px !important;
      gap: 8px !important;
    }

    .item-name {
      font-size: 12px !important;
    }

    .qty-box {
      gap: 4px !important;
      padding: 3px 5px !important;
    }

    .qty-btn {
      width: 22px !important;
      height: 22px !important;
      min-height: 36px !important;
    }

    .item-total {
      font-size: 12px !important;
      min-width: 55px;
    }

    .label {
      font-size: 10px !important;
    }

    .input {
      padding: 8px 10px !important;
      font-size: 12px !important;
    }

    .confirm-btn {
      padding: 10px 12px !important;
      font-size: 11px !important;
      min-height: 44px !important;
    }
  }

  /* Phone - 480px to 639px */
  @media (max-width: 639px) and (min-width: 480px) {
    .cart-header {
      padding: 10px 12px !important;
      flex-wrap: wrap;
    }

    .header-title {
      font-size: 14px !important;
      flex: 1 1 100%;
    }

    .continue-shopping-btn {
      padding: 5px 10px !important;
      font-size: 10px !important;
      width: 100%;
    }

    .main-content {
      padding: 16px 10px;
    }

    .layout {
      grid-template-columns: 1fr !important;
      gap: 12px !important;
    }

    .checkout-section {
      padding: 14px !important;
    }

    .cart-section {
      padding: 14px !important;
    }

    .section-title {
      font-size: 13px !important;
      margin-bottom: 12px !important;
    }

    .cart-item {
      padding: 10px !important;
      gap: 6px !important;
    }

    .item-name {
      font-size: 11px !important;
    }

    .qty-box {
      gap: 4px !important;
    }

    .qty-btn {
      width: 20px !important;
      height: 20px !important;
      font-size: 10px !important;
    }

    .item-total {
      font-size: 11px !important;
      min-width: 50px;
    }

    .label {
      font-size: 9px !important;
      margin-bottom: 2px !important;
    }

    .input {
      padding: 6px 8px !important;
      font-size: 11px !important;
      min-height: 36px !important;
    }

    .confirm-btn {
      padding: 8px 10px !important;
      font-size: 10px !important;
      min-height: 40px !important;
    }
  }

  /* Small Phone - 360px to 479px */
  @media (max-width: 479px) and (min-width: 360px) {
    .cart-header {
      padding: 8px 10px !important;
      flex-wrap: wrap;
    }

    .header-title {
      font-size: 13px !important;
      flex: 1 1 100%;
    }

    .continue-shopping-btn {
      padding: 5px 8px !important;
      font-size: 9px !important;
      width: 100%;
    }

    .main-content {
      padding: 12px 8px;
    }

    .layout {
      grid-template-columns: 1fr !important;
      gap: 10px !important;
    }

    .checkout-section {
      padding: 12px !important;
    }

    .cart-section {
      padding: 12px !important;
    }

    .section-title {
      font-size: 12px !important;
      margin-bottom: 10px !important;
    }

    .cart-item {
      padding: 8px !important;
      gap: 4px !important;
      flex-direction: column !important;
    }

    .item-name {
      font-size: 10px !important;
    }

    .qty-box {
      width: 100% !important;
      justify-content: center !important;
    }

    .qty-btn {
      width: 18px !important;
      height: 18px !important;
      min-height: 32px !important;
    }

    .item-total {
      font-size: 10px !important;
      width: 100%;
      text-align: center !important;
    }

    .label {
      font-size: 8px !important;
    }

    .input {
      padding: 5px 6px !important;
      font-size: 10px !important;
      min-height: 32px !important;
    }

    .error-text {
      font-size: 10px !important;
    }

    .input-hint {
      font-size: 10px !important;
    }

    .confirm-btn {
      padding: 6px 8px !important;
      font-size: 9px !important;
      min-height: 36px !important;
      gap: 4px !important;
    }
  }

  /* Extra Small Phone - Below 360px */
  @media (max-width: 359px) {
    .cart-header {
      padding: 6px 8px !important;
      flex-direction: column;
      gap: 4px !important;
    }

    .header-title {
      font-size: 12px !important;
      margin: 0 !important;
    }

    .continue-shopping-btn {
      padding: 4px 6px !important;
      font-size: 8px !important;
      width: 100%;
    }

    .main-content {
      padding: 10px 6px;
    }

    .layout {
      grid-template-columns: 1fr !important;
      gap: 8px !important;
    }

    .checkout-section {
      padding: 10px !important;
    }

    .cart-section {
      padding: 10px !important;
    }

    .section-title {
      font-size: 11px !important;
      margin-bottom: 8px !important;
    }

    .cart-item {
      padding: 6px !important;
      flex-direction: column !important;
    }

    .item-name {
      font-size: 9px !important;
    }

    .qty-btn {
      width: 16px !important;
      height: 16px !important;
      min-height: 28px !important;
    }

    .item-total {
      font-size: 9px !important;
    }

    .label {
      font-size: 7px !important;
    }

    .input {
      padding: 4px 4px !important;
      font-size: 9px !important;
      min-height: 28px !important;
    }

    .confirm-btn {
      padding: 4px 6px !important;
      font-size: 8px !important;
      min-height: 32px !important;
    }
  }

  /* Landscape orientation */
  @media (max-height: 600px) and (orientation: landscape) {
    .cart-header {
      padding: 6px 12px !important;
    }

    .main-content {
      padding: 8px 12px;
    }

    .layout {
      gap: 12px !important;
    }
  }

  /* Touch device optimizations */
  @media (hover: none) and (pointer: coarse) {
    button {
      min-height: 44px;
      -webkit-tap-highlight-color: transparent;
    }

    .input {
      min-height: 44px;
      font-size: 16px !important;
    }
  }

  /* High DPI screens */
  @media (min-resolution: 2dppx) {
    .cart-section, .checkout-section {
      border-radius: 8px;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
    }

    .cart-item {
      border-radius: 6px;
    }
  }

  /* Safe area support */
  @media (max-width: 639px) {
    .cart-header {
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

export default Cart;