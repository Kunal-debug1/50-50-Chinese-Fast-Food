import { createContext, useContext, useEffect, useState } from "react";

const HotelContext = createContext();

export const HotelProvider = ({ children }) => {

  /* ================= TABLES ================= */

  const [tables, setTables] = useState([]);
  const [loadingTables, setLoadingTables] = useState(true);
  const [selectedTable, setSelectedTable] = useState(() => {
  const saved = localStorage.getItem("selectedTable");
  return saved ? JSON.parse(saved) : null;
});

  const fetchTables = async () => {
    try {
      const res = await fetch("https://five0-50-chinese-fast-food-6.onrender.com/tables");
      const data = await res.json();
      setTables(data);
    } catch (err) {
      console.error("Table fetch error:", err);
    } finally {
      setLoadingTables(false);
    }
  };

  useEffect(() => {
    fetchTables();
  }, []);

  /* ================= SESSION ================= */

  const createSession = () => {
    const newSession = Date.now().toString();
    localStorage.setItem("sessionId", newSession);
  };

  /* ================= CART ================= */

  const [cart, setCart] = useState([]);

  const addToCart = (item) => {
    setCart((prev) => {
      const exists = prev.find((i) => i.id === item.id);
      if (exists) {
        return prev.map((i) =>
          i.id === item.id
            ? { ...i, quantity: i.quantity + 1 }
            : i
        );
      }
      return [...prev, { ...item, quantity: 1 }];
    });
  };

  const updateQuantity = (id, type) => {
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.id !== id) return item;

          if (type === "increase") {
            return { ...item, quantity: item.quantity + 1 };
          }

          if (type === "decrease") {
            if (item.quantity === 1) return null;
            return { ...item, quantity: item.quantity - 1 };
          }

          return item;
        })
        .filter(Boolean)
    );
  };

  const clearCart = () => setCart([]);

  /* ================= BILLING ================= */

  const [customerInfo, setCustomerInfo] = useState({
    name: "",
    whatsapp: "",
  });

  /* ================= PLACE ORDER ================= */

  const placeOrder = async () => {
    if (!selectedTable || cart.length === 0) return;

    const total = cart.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );

    const sessionId = localStorage.getItem("sessionId");

    if (!sessionId) {
      console.error("Session ID missing");
      return;
    }

    try {
      const res = await fetch("https://five0-50-chinese-fast-food-6.onrender.com/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          table_id: selectedTable.id,
          items: cart,
          total,
          customer_name: customerInfo.name,
          whatsapp: customerInfo.whatsapp,
          session_id: sessionId,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        console.error("Backend error:", errorData);
        return;
      }

      clearCart();
      fetchTables();
    } catch (err) {
      console.error("Order error:", err);
    }
  };

  /* ================= ADMIN ================= */

  const [adminLoggedIn, setAdminLoggedIn] = useState(false);

  const adminLogin = (username, password) => {
    if (username === "admin" && password === "1234") {
      setAdminLoggedIn(true);
      return true;
    }
    return false;
  };

  const adminLogout = () => {
    setAdminLoggedIn(false);
  };

  /* ================= ORDER FETCH ================= */

  const fetchOrders = async () => {
    const res = await fetch("https://five0-50-chinese-fast-food-6.onrender.com/orders");
    return await res.json();
  };

  const updateOrderStatus = async (orderId, status) => {
    await fetch(`https://five0-50-chinese-fast-food-6.onrender.com/orders/${orderId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
  };

  const markAsPaid = async (orderId) => {
    await fetch(
      `https://five0-50-chinese-fast-food-6.onrender.com/orders/${orderId}/pay`,
      { method: "PUT" }
    );
    fetchTables();
  };

  /* ================= WHATSAPP BILL ================= */

  const generateWhatsAppBill = (order) => {
    if (!order?.whatsapp) return;

    const itemsText = order.items
      .map(
        (item) =>
          `🍽 ${item.name} x${item.quantity} - ₹${item.price * item.quantity}`
      )
      .join("\n");

    const message = `
🏮 *50-50 Chinese Restaurant* 🏮

🧾 *Bill Summary*
-------------------------
${itemsText}
-------------------------
💰 Total: ₹${order.total}

🙏 Thank you for dining with us!
`;

    const encoded = encodeURIComponent(message);
    const phone = order.whatsapp.replace(/\D/g, "");

    window.open(
      `https://wa.me/91${phone}?text=${encoded}`,
      "_blank"
    );
  };

  /* ================= END SESSION ================= */

  const endSession = () => {
    setSelectedTable(null);
    setCart([]);
    setCustomerInfo({
      name: "",
      whatsapp: "",
    });
    localStorage.removeItem("sessionId");
  };

  return (
    <HotelContext.Provider
      value={{
        tables,
        loadingTables,
        selectedTable,
        setSelectedTable,
        createSession,
        cart,
        addToCart,
        updateQuantity,
        clearCart,
        placeOrder,
        customerInfo,
        setCustomerInfo,
        fetchOrders,
        updateOrderStatus,
        markAsPaid,
        adminLogin,
        adminLogout,
        adminLoggedIn,
        generateWhatsAppBill,
        endSession,
      }}
    >
      {children}
    </HotelContext.Provider>
  );
};

export const useHotel = () => useContext(HotelContext);
