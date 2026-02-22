import { useHotel } from "../context/HotelContext";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

function Menu() {
  // 1. Safe Context Extraction
  const hotelContext = useHotel();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");

  // ERROR HANDLING: Check if context exists
  if (!hotelContext) {
    return (
      <div style={{ padding: "40px", textAlign: "center", color: "red" }}>
        Error: HotelContext not found. Please wrap this component in a HotelProvider.
      </div>
    );
  }

  const { addToCart, updateQuantity, cart } = hotelContext;

  // ERROR HANDLING: Ensure cart is an array before reducing
  const safeCart = Array.isArray(cart) ? cart : [];

  const totalItems = safeCart.reduce((sum, item) => sum + (item.quantity || 0), 0);
  const totalAmount = safeCart.reduce(
    (sum, item) => sum + (item.price || 0) * (item.quantity || 0),
    0
  );

  const getItemQuantity = (id) => {
    const found = safeCart.find((item) => item.id === id);
    return found ? found.quantity : 0;
  };

  // MENU DATA - SAME AS ORIGINAL
  const menuData = [
    {
      category: "HOT SOUP",
      items: [
        { id: 1, name: "Veg Manchow Soup", price: 90, img: "/assets/soups/veg_manchow_soup.jpg" },
        { id: 2, name: "Hot & Sour Soup", price: 90, img: "/assets/soups/hot_sour_soup.jpg" },
        { id: 3, name: "Lemon Coriander Soup", price: 90, img: "/assets/soups/lemon_coriander_soup.jpg" },
      ],
    },
    {
      category: "STARTERS",
      items: [
        { id: 4, name: "Veg Manchurian Dry", price: 110, img: "/assets/starters/veg_manchurian_dry.jpg" },
        { id: 5, name: "Veg Manchurian Gravy", price: 120, img: "/assets/starters/veg_manchurian_gravy.jpg" },
        { id: 6, name: "Gobi Manchurian", price: 130, img: "/assets/starters/gobi_manchurian.jpg" },
        { id: 7, name: "Soyabin Chilly", price: 140, img: "/assets/starters/soyabin_chilly.jpg" },
        { id: 8, name: "Gobi Kentucky", price: 150, img: "/assets/starters/gobi_kentucky.jpg" },
        { id: 9, name: "Baby Corn Kentucky", price: 150, img: "/assets/starters/babycorn_kentucky.jpg" },
        { id: 10, name: "Soyabin Kentucky", price: 120, img: "/assets/starters/soyabin_kentucky.jpg" },
        { id: 11, name: "Mushroom Kentucky", price: 130, img: "/assets/starters/mushroom_kentucky.jpg" },
        { id: 12, name: "Paneer Kentucky", price: 140, img: "/assets/starters/paneer_kentucky.jpg" },
        { id: 13, name: "Chinese Bhel", price: 130, img: "/assets/starters/chinese_bhel.jpg" },
      ],
    },
    {
      category: "FRIES & MOMOS",
      items: [
        { id: 14, name: "Salted Fries", price: 100, img: "/assets/fries/salted_fries.jpg" },
        { id: 15, name: "Peri Peri Fries", price: 120, img: "/assets/fries/peri_peri_fries.jpg" },
        { id: 16, name: "Cheese Fries", price: 140, img: "/assets/fries/cheese_fries.jpg" },
        { id: 17, name: "Paneer Momos", price: 90, img: "/assets/fries/paneer_momos.jpg" },
        { id: 18, name: "Mix Veg Momos", price: 90, img: "/assets/fries/mix_veg_momos.jpg" },
        { id: 19, name: "Chilly Momos", price: 120, img: "/assets/fries/chilly_momos.jpg" },
      ],
    },
    {
      category: "NOODLES",
      items: [
        { id: 20, name: "Veg Hakka Noodles", price: 100, img: "/assets/noodles/veg_hakka_noodles.jpg" },
        { id: 21, name: "Schezwan Noodles", price: 110, img: "/assets/noodles/schezwan_noodles.jpg" },
        { id: 22, name: "Singapuri Noodles", price: 130, img: "/assets/noodles/singapuri_noodles.jpg" },
        { id: 23, name: "Paneer Noodles", price: 130, img: "/assets/noodles/paneer_noodles.jpg" },
        { id: 24, name: "Manchurian Noodles", price: 130, img: "/assets/noodles/manchurian_noodles.jpg" },
        { id: 25, name: "Paneer Schezwan Noodles", price: 130, img: "/assets/noodles/paneer_schezwan_noodles.jpg" },
        { id: 26, name: "Schezwan Manchurian Noodles", price: 130, img: "/assets/noodles/schezwan_manchurian_noodles.jpg" },
        { id: 27, name: "Special Hakka Noodles", price: 140, img: "/assets/noodles/special_hakka_noodles.jpg" },
        { id: 28, name: "Chilly Garlic Noodles", price: 150, img: "/assets/noodles/chilly_garlic_noodles.jpg" },
        { id: 29, name: "Triple Schezwan Noodles", price: 160, img: "/assets/noodles/triple_schezwan_noodles.jpg" },
      ],
    },
    {
      category: "50/50 SPECIAL STATION",
      items: [
        { id: 30, name: "Veg Barmuda", price: 160, img: "/assets/special/veg_barmuda.jpg" },
        { id: 31, name: "Paneer Saibo", price: 160, img: "/assets/special/paneer_saibo.jpg" },
        { id: 32, name: "Paneer Babycorn Hongkong", price: 160, img: "/assets/special/paneer_babycorn_hongkong.jpg" },
        { id: 33, name: "Paneer Crunchy", price: 160, img: "/assets/special/paneer_crunchy.jpg" },
        { id: 34, name: "Potato Crunchy", price: 160, img: "/assets/special/potato_crunchy.jpg" },
        { id: 35, name: "Cheese Corn Ball", price: 190, img: "/assets/special/cheese_corn_ball.jpg" },
        { id: 36, name: "Veg Crispy", price: 170, img: "/assets/special/veg_crispy.jpg" },
        { id: 37, name: "Veg Lollipop", price: 170, img: "/assets/special/veg_lollipop.jpg" },
        { id: 38, name: "Golden Crispy Corn", price: 160, img: "/assets/special/golden_crispy_corn.jpg" },
      ],
    },
    {
      category: "PANEER",
      items: [
        { id: 39, name: "Paneer Chilly Dry", price: 160, img: "/assets/paneer/paneer_chilly_dry.jpg" },
        { id: 40, name: "Paneer Chilly Gravy", price: 170, img: "/assets/paneer/paneer_chilly_gravy.jpg" },
        { id: 41, name: "Mushroom Chilly", price: 160, img: "/assets/paneer/mushroom_chilly.jpg" },
        { id: 42, name: "Paneer 65", price: 170, img: "/assets/paneer/paneer_65.jpg" },
        { id: 43, name: "Paneer Shezwan", price: 170, img: "/assets/paneer/paneer_shezwan.jpg" },
        { id: 44, name: "Hot Garlic Paneer", price: 170, img: "/assets/paneer/hot_garlic_paneer.jpg" },
        { id: 45, name: "Mushroom Chingari", price: 160, img: "/assets/paneer/mushroom_chingari.jpg" },
      ],
    },
    {
      category: "RICE",
      items: [
        { id: 46, name: "Veg Fried Rice", price: 100, img: "/assets/rice/veg_fried_rice.jpg" },
        { id: 47, name: "Schezwan Fried Rice", price: 110, img: "/assets/rice/schezwan_fried_rice.jpg" },
        { id: 48, name: "Singapuri Rice", price: 130, img: "/assets/rice/singapuri_rice.jpg" },
        { id: 49, name: "Manchurian Rice", price: 130, img: "/assets/rice/manchurian_rice.jpg" },
        { id: 50, name: "Paneer Fried Rice", price: 130, img: "/assets/rice/paneer_fried_rice.jpg" },
        { id: 51, name: "Hongkong Rice", price: 130, img: "/assets/rice/hongkong_rice.jpg" },
        { id: 52, name: "Schezwan Manchurian Rice", price: 130, img: "/assets/rice/schezwan_manchurian_rice.jpg" },
        { id: 53, name: "Special Fried Rice", price: 140, img: "/assets/rice/special_fried_rice.jpg" },
        { id: 54, name: "Chilly Garlic Rice", price: 150, img: "/assets/rice/chilly_garlic_rice.jpg" },
        { id: 55, name: "Triple Schezwan Rice", price: 160, img: "/assets/rice/triple_schezwan_rice.jpg" },
      ],
    },
    {
      category: "COFFEE",
      items: [
        { id: 56, name: "Cold Coffee", price: 70, img: "/assets/coffee/cold_coffee.jpg" },
      ],
    },
    category: "WATER",
      items: [
        { id: 57, name: "Water Bottle Normal", price: 20, img: "/assets/coffee/water_bottle.jpg" }
        { id: 58, name: "Water Bottle Cold", price: 20, img: "/assets/coffee/water_bottle.jpg" },
      ],
    },
  ];

  const filteredMenuData = menuData
    .map((section) => ({
      ...section,
      items: section.items.filter((item) =>
        item.name.toLowerCase().includes(search.toLowerCase())
      ),
    }))
    .filter((section) => section.items.length > 0);

  // ERROR HANDLING: Handle function calls safely
  const handleAddToCart = (item) => {
    if (typeof addToCart === "function") {
      addToCart(item);
    } else {
      console.error("addToCart is not a function");
    }
  };

  const handleUpdateQuantity = (id, type) => {
    if (typeof updateQuantity === "function") {
      updateQuantity(id, type);
    } else {
      console.error("updateQuantity is not a function");
    }
    
  };

  return (
    <div style={styles.container}>
      <style>{mediaQueries}</style>
      
      {/* MAIN CONTENT */}
      <div style={styles.mainContent}>
        {/* HEADER */}
        <div style={styles.header}>
          <h1 style={styles.title}>Our Menu</h1>
          <p style={styles.subtitle}>Authentic Chinese Vegetarian Cuisine</p>
        </div>

        {/* SEARCH BAR */}
        <div style={styles.searchContainer}>
          <input
            type="text"
            placeholder="Search dishes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={styles.search}
          />
          <span style={styles.searchIcon}>🔍</span>
        </div>

        {/* MENU SECTIONS */}
        {filteredMenuData.length === 0 ? (
          <div style={styles.noResults}>
            <p style={styles.noResultsText}>No dishes found for "{search}"</p>
          </div>
        ) : (
          filteredMenuData.map((section) => (
            <div key={section.category} style={styles.section}>
              <h2 style={styles.sectionTitle}>{section.category}</h2>

              <div style={styles.grid}>
                {section.items.map((item) => (
                  <div key={item.id} style={styles.card}>
                    <div style={styles.imageContainer}>
                      <img
                        src={item.img}
                        alt={item.name}
                        style={styles.image}
                        onError={(e) => {
                          e.target.onerror = null;
                          e.target.src = "https://placehold.co/400x300?text=No+Image";
                        }}
                      />
                    </div>

                    <div style={styles.cardContent}>
                      <h3 style={styles.itemName}>{item.name}</h3>
                      <p style={styles.price}>₹{item.price}</p>

                      {getItemQuantity(item.id) === 0 ? (
                        <button
                          style={styles.button}
                          onMouseEnter={(e) => e.target.style.opacity = "0.9"}
                          onMouseLeave={(e) => e.target.style.opacity = "1"}
                          onClick={() => handleAddToCart(item)}
                        >
                          Add to Cart
                        </button>
                      ) : (
                        <div style={styles.qtyContainer}>
                          <button
                            style={styles.qtyBtn}
                            onClick={() => handleUpdateQuantity(item.id, "decrease")}
                          >
                            −
                          </button>

                          <span style={styles.qtyNumber}>
                            {getItemQuantity(item.id)}
                          </span>

                          <button
                            style={styles.qtyBtn}
                            onClick={() => handleUpdateQuantity(item.id, "increase")}
                          >
                            +
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {/* FLOATING CART */}
      {totalItems > 0 && (
        <div
          className="floating-cart"
          style={styles.floatingCart}
          onClick={() => navigate("/cart")}
          onMouseEnter={(e) => e.target.style.transform = "translateX(-50%) translateY(-10px)"}
          onMouseLeave={(e) => e.target.style.transform = "translateX(-50%) translateY(0)"}
        >
          <div style={styles.cartContent}>
            <span style={styles.cartItems}>
              🛒 {totalItems} item{totalItems > 1 ? "s" : ""}
            </span>
            <span style={styles.cartAmount}>₹{totalAmount}</span>
          </div>
          <span style={styles.cartArrow}>→</span>
        </div>
      )}
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

  mainContent: {
    maxWidth: "1400px",
    margin: "0 auto",
    padding: "30px 16px",
    width: "100%",
    boxSizing: "border-box",
  },

  header: {
    textAlign: "center",
    marginBottom: "30px",
  },

  title: {
    fontSize: "36px",
    fontWeight: "700",
    color: "#1C1C1C",
    margin: "0 0 8px 0",
  },

  subtitle: {
    fontSize: "14px",
    color: "#9C9C9C",
    margin: 0,
  },

  searchContainer: {
    position: "relative",
    maxWidth: "500px",
    margin: "0 auto 40px",
    width: "100%",
    boxSizing: "border-box",
  },

  search: {
    width: "100%",
    padding: "12px 16px 12px 40px",
    borderRadius: "6px",
    border: "1px solid #E8E8E8",
    fontSize: "14px",
    background: "#FFFFFF",
    boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
    boxSizing: "border-box",
  },

  searchIcon: {
    position: "absolute",
    left: "12px",
    top: "50%",
    transform: "translateY(-50%)",
    fontSize: "16px",
    pointerEvents: "none",
  },

  section: {
    marginBottom: "45px",
  },

  sectionTitle: {
    fontSize: "18px",
    fontWeight: "700",
    color: "#1C1C1C",
    borderBottom: "2px solid #FFD700",
    display: "inline-block",
    paddingBottom: "8px",
    marginBottom: "20px",
  },

  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
    gap: "16px",
    width: "100%",
  },

  card: {
    background: "#FFFFFF",
    borderRadius: "8px",
    overflow: "hidden",
    boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
    transition: "all 0.2s ease",
    border: "1px solid #F0F0F0",
    display: "flex",
    flexDirection: "column",
    height: "100%",
  },

  imageContainer: {
    width: "100%",
    height: "180px",
    overflow: "hidden",
    background: "#F5F5F5",
    flexShrink: 0,
  },

  image: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    transition: "transform 0.3s ease",
  },

  cardContent: {
    padding: "16px",
    textAlign: "center",
    flex: "1 1 auto",
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
  },

  itemName: {
    fontSize: "14px",
    fontWeight: "600",
    color: "#1C1C1C",
    margin: "0 0 6px 0",
    wordWrap: "break-word",
  },

  price: {
    fontSize: "16px",
    fontWeight: "700",
    color: "#FFD700",
    margin: "0 0 12px 0",
  },

  button: {
    background: "#FFD700",
    border: "none",
    padding: "8px 16px",
    borderRadius: "4px",
    cursor: "pointer",
    fontWeight: "600",
    fontSize: "12px",
    color: "#1C1C1C",
    transition: "all 0.2s ease",
    width: "100%",
    boxSizing: "border-box",
  },

  qtyContainer: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    gap: "10px",
  },

  qtyBtn: {
    background: "#FFD700",
    border: "none",
    width: "28px",
    height: "28px",
    borderRadius: "4px",
    fontWeight: "700",
    cursor: "pointer",
    color: "#1C1C1C",
    transition: "all 0.2s ease",
    fontSize: "14px",
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },

  qtyNumber: {
    fontSize: "14px",
    fontWeight: "600",
    minWidth: "30px",
    textAlign: "center",
  },

  floatingCart: {
    position: "fixed",
    bottom: "24px",
    left: "50%",
    transform: "translateX(-50%)",
    background: "#FFD700",
    padding: "14px 28px",
    borderRadius: "8px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "20px",
    cursor: "pointer",
    boxShadow: "0 8px 24px rgba(255, 215, 0, 0.35)",
    zIndex: 1000,
    transition: "all 0.3s ease",
    boxSizing: "border-box",
  },

  cartContent: {
    display: "flex",
    gap: "20px",
    alignItems: "center",
  },

  cartItems: {
    fontSize: "13px",
    fontWeight: "600",
    color: "#1C1C1C",
    whiteSpace: "nowrap",
  },

  cartAmount: {
    fontSize: "16px",
    fontWeight: "700",
    color: "#1C1C1C",
    minWidth: "60px",
  },

  cartArrow: {
    fontSize: "18px",
    fontWeight: "700",
    flexShrink: 0,
  },

  noResults: {
    background: "#FFFFFF",
    borderRadius: "8px",
    padding: "60px 20px",
    textAlign: "center",
  },

  noResultsText: {
    fontSize: "16px",
    color: "#9C9C9C",
    margin: 0,
  },
};

/* ================= MEDIA QUERIES ================= */

const mediaQueries = `
  * {
    box-sizing: border-box;
  }

  /* Desktop - 1400px and above */
  @media (min-width: 1400px) {
    .menu-container {
      padding: 40px 30px;
    }
  }

  /* Tablet Landscape - 1024px to 1399px */
  @media (max-width: 1399px) {
    .floating-cart {
      padding: 12px 24px;
      gap: 16px;
    }

    .floating-cart span {
      font-size: 12px;
    }
  }

  /* Tablet - 768px to 1023px */
  @media (max-width: 1023px) {
    h1 {
      font-size: 28px !important;
    }

    .section-title {
      font-size: 16px !important;
    }

    .grid {
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)) !important;
      gap: 12px !important;
    }

    .floating-cart {
      bottom: 16px;
      padding: 12px 20px;
      gap: 12px;
    }

    .cart-items {
      font-size: 12px !important;
    }

    .cart-amount {
      font-size: 14px !important;
      min-width: 50px;
    }

    .cart-arrow {
      font-size: 16px !important;
    }
  }

  /* Small Tablet / Large Phone - 640px to 767px */
  @media (max-width: 767px) {
    h1 {
      font-size: 24px !important;
    }

    .subtitle {
      font-size: 13px !important;
    }

    .section-title {
      font-size: 15px !important;
    }

    .search {
      font-size: 13px !important;
      padding: 10px 14px 10px 36px !important;
    }

    .search-icon {
      font-size: 14px !important;
      left: 10px !important;
    }

    .grid {
      grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)) !important;
      gap: 10px !important;
    }

    .image-container {
      height: 150px !important;
    }

    .card-content {
      padding: 12px !important;
    }

    .item-name {
      font-size: 13px !important;
      margin-bottom: 4px !important;
    }

    .price {
      font-size: 14px !important;
      margin-bottom: 8px !important;
    }

    .button {
      padding: 6px 12px !important;
      font-size: 11px !important;
    }

    .qty-btn {
      width: 26px !important;
      height: 26px !important;
      font-size: 13px !important;
    }

    .qty-number {
      font-size: 12px !important;
      min-width: 28px;
    }

    .floating-cart {
      bottom: 12px;
      left: 50%;
      right: auto;
      padding: 10px 16px;
      gap: 10px;
      width: calc(100% - 24px);
      max-width: calc(100% - 24px);
    }

    .cart-content {
      gap: 12px !important;
      flex: 1;
      min-width: 0;
    }

    .cart-items {
      font-size: 11px !important;
    }

    .cart-amount {
      font-size: 13px !important;
      min-width: 45px;
    }

    .cart-arrow {
      font-size: 14px !important;
    }
  }

  /* Phone - 480px to 639px */
  @media (max-width: 639px) {
    h1 {
      font-size: 20px !important;
      margin-bottom: 4px !important;
    }

    .subtitle {
      font-size: 12px !important;
    }

    .search-container {
      margin-bottom: 30px !important;
    }

    .section-title {
      font-size: 14px !important;
      margin-bottom: 16px !important;
    }

    .grid {
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)) !important;
      gap: 8px !important;
    }

    .image-container {
      height: 130px !important;
    }

    .card-content {
      padding: 10px !important;
    }

    .item-name {
      font-size: 12px !important;
      margin-bottom: 3px !important;
    }

    .price {
      font-size: 13px !important;
      margin-bottom: 6px !important;
    }

    .button {
      padding: 6px 10px !important;
      font-size: 10px !important;
    }

    .qty-container {
      gap: 6px !important;
    }

    .qty-btn {
      width: 24px !important;
      height: 24px !important;
      font-size: 12px !important;
    }

    .qty-number {
      font-size: 11px !important;
      min-width: 26px;
    }

    .floating-cart {
      bottom: 10px;
      padding: 8px 12px;
      gap: 8px;
      width: calc(100% - 20px);
    }

    .cart-content {
      gap: 8px !important;
    }

    .cart-items {
      font-size: 10px !important;
    }

    .cart-amount {
      font-size: 12px !important;
      min-width: 40px;
    }

    .cart-arrow {
      font-size: 12px !important;
    }
  }

  /* Small Phone - Below 480px */
  @media (max-width: 479px) {
    h1 {
      font-size: 18px !important;
      margin-bottom: 2px !important;
    }

    .subtitle {
      font-size: 11px !important;
    }

    .search-container {
      margin-bottom: 20px !important;
    }

    .search {
      font-size: 12px !important;
      padding: 8px 12px 8px 32px !important;
    }

    .search-icon {
      font-size: 12px !important;
      left: 8px !important;
    }

    .section {
      margin-bottom: 30px !important;
    }

    .section-title {
      font-size: 13px !important;
      margin-bottom: 12px !important;
      padding-bottom: 6px !important;
    }

    .grid {
      grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)) !important;
      gap: 6px !important;
    }

    .image-container {
      height: 110px !important;
    }

    .card-content {
      padding: 8px !important;
    }

    .item-name {
      font-size: 11px !important;
      margin-bottom: 2px !important;
    }

    .price {
      font-size: 12px !important;
      margin-bottom: 4px !important;
    }

    .button {
      padding: 5px 8px !important;
      font-size: 9px !important;
    }

    .qty-container {
      gap: 4px !important;
    }

    .qty-btn {
      width: 22px !important;
      height: 22px !important;
      font-size: 11px !important;
      padding: 0 !important;
    }

    .qty-number {
      font-size: 10px !important;
      min-width: 24px;
    }

    .floating-cart {
      bottom: 8px;
      padding: 6px 10px;
      gap: 6px;
      width: calc(100% - 16px);
      border-radius: 6px;
    }

    .cart-content {
      gap: 6px !important;
      flex-direction: column;
      align-items: flex-start;
    }

    .cart-items {
      font-size: 9px !important;
    }

    .cart-amount {
      font-size: 11px !important;
      min-width: auto;
    }

    .cart-arrow {
      display: none !important;
    }
  }

  /* Extra Small Phone - Below 360px */
  @media (max-width: 359px) {
    h1 {
      font-size: 16px !important;
    }

    .grid {
      grid-template-columns: repeat(2, 1fr) !important;
    }

    .image-container {
      height: 100px !important;
    }

    .floating-cart {
      padding: 4px 8px;
    }
  }

  /* Landscape orientation adjustments */
  @media (max-height: 600px) and (orientation: landscape) {
    h1 {
      margin-bottom: 4px !important;
    }

    .search-container {
      margin-bottom: 20px !important;
    }

    .grid {
      gap: 8px !important;
    }

    .image-container {
      height: 120px !important;
    }

    .floating-cart {
      bottom: 8px;
      padding: 8px 16px;
    }
  }

  /* Touch device optimizations */
  @media (hover: none) and (pointer: coarse) {
    button, a {
      min-height: 44px;
      min-width: 44px;
      padding: 10px;
    }

    .button {
      min-height: 40px !important;
      padding: 10px 12px !important;
    }

    .qty-btn {
      min-height: 40px !important;
      min-width: 40px !important;
    }
  }

  /* High DPI screens */
  @media (min-resolution: 2dppx) {
    .card, .button, .qty-btn {
      border-radius: 6px;
    }
  }

  /* Prevent zoom on iPhone input fields */
  @media (max-width: 768px) {
    input, button, select {
      font-size: 16px !important;
    }
  }

  /* Prevent text selection issues on mobile */
  @media (max-width: 767px) {
    .cart-items, .cart-amount {
      user-select: none;
      -webkit-user-select: none;
      -moz-user-select: none;
      -ms-user-select: none;
    }
  }
`;

export default Menu;
