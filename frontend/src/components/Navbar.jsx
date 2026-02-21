import { Link, useLocation } from "react-router-dom";
import { useHotel } from "../context/HotelContext";
import { useState } from "react";

function Navbar() {
  const { selectedTable } = useHotel();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleLinkClick = () => {
    setMenuOpen(false);
  };

  return (
    <nav style={styles.navbar}>
      <style>{mediaQueries}</style>
      <div style={styles.navbarContainer}>

        {/* LOGO */}
        <Link to="/" style={styles.logoSection} onClick={handleLinkClick}>
          <img src="/logo.png" alt="Logo" style={styles.logoImg} />
          <span style={styles.brandName}>
            50-50{" "}
            <span style={styles.brandHighlight}>Chinese Fast Food</span>
          </span>
        </Link>

        {/* MOBILE TOGGLE */}
        <button
          className="navbar-hamburger"
          style={styles.hamburger}
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label="Toggle menu"
        >
          <span style={{
            ...styles.bar,
            transform: menuOpen ? "rotate(45deg) translate(5px, 6px)" : "none",
          }} />
          <span style={{
            ...styles.bar,
            opacity: menuOpen ? 0 : 1,
            transform: menuOpen ? "translateX(-10px)" : "none",
          }} />
          <span style={{
            ...styles.bar,
            transform: menuOpen ? "rotate(-45deg) translate(5px, -6px)" : "none",
          }} />
        </button>

        {/* NAV LINKS */}
        <div 
          className={`navbar-links ${menuOpen ? 'mobile-show' : ''}`}
          style={{
            ...styles.navLinks,
            ...(menuOpen ? styles.navLinksMobileShow : {}),
          }}>
          <NavItem to="/tables" currentPath={location.pathname} onClick={handleLinkClick}>
            Tables
          </NavItem>
          <NavItem to="/menu" currentPath={location.pathname} onClick={handleLinkClick}>
            Menu
          </NavItem>
          <NavItem to="/admin-login" currentPath={location.pathname} onClick={handleLinkClick}>
            Admin
          </NavItem>
        </div>

      </div>
    </nav>
  );
}

function NavItem({ to, children, currentPath, onClick }) {
  const isActive = currentPath === to;
  const [hovered, setHovered] = useState(false);

  return (
    <Link
      to={to}
      style={{
        ...styles.navLink,
        ...(isActive ? styles.navLinkActive : {}),
        ...(hovered && !isActive ? styles.navLinkHover : {}),
      }}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {children}
    </Link>
  );
}

/* ================= STYLES ================= */

const styles = {
  navbar: {
    background: "#FFFFFF",
    borderBottom: "1px solid #E8E8E8",
    boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
    position: "sticky",
    top: 0,
    zIndex: 100,
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  },

  navbarContainer: {
    maxWidth: "1200px",
    margin: "0 auto",
    padding: "0 16px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    height: "64px",
    width: "100%",
    boxSizing: "border-box",
  },

  logoSection: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    textDecoration: "none",
    minWidth: "fit-content",
    flex: "0 1 auto",
  },

  logoImg: {
    width: "36px",
    height: "36px",
    objectFit: "contain",
    borderRadius: "6px",
    flexShrink: 0,
  },

  brandName: {
    fontSize: "16px",
    fontWeight: "700",
    color: "#000000",
    letterSpacing: "-0.3px",
    whiteSpace: "nowrap",
  },

  brandHighlight: {
    color: "#FFD700",
    display: "block",
    fontSize: "12px",
    fontWeight: "600",
    letterSpacing: "-0.2px",
  },

  navLinks: {
    display: "flex",
    alignItems: "center",
    gap: "4px",
    flex: "1 1 auto",
    justifyContent: "flex-end",
  },

  navLinksMobileShow: {
    display: "flex",
    flexDirection: "column",
    position: "fixed",
    top: "64px",
    left: 0,
    right: 0,
    background: "#FFFFFF",
    borderBottom: "1px solid #E8E8E8",
    padding: "12px 16px",
    gap: "8px",
    boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
    width: "100%",
    boxSizing: "border-box",
    zIndex: 99,
  },

  navLink: {
    textDecoration: "none",
    color: "#636363",
    fontSize: "14px",
    fontWeight: "500",
    padding: "8px 12px",
    borderRadius: "4px",
    transition: "all 0.2s ease",
    whiteSpace: "nowrap",
    display: "inline-block",
  },

  navLinkHover: {
    color: "#1c1c1c",
    background: "#FFD700",
  },

  navLinkActive: {
    color: "#FFD700",
    background: "#FFF5F5",
    fontWeight: "600",
  },

  hamburger: {
    display: "none",
    flexDirection: "column",
    gap: "5px",
    background: "none",
    border: "none",
    cursor: "pointer",
    padding: "8px 4px",
    marginLeft: "auto",
    minWidth: "44px",
    height: "44px",
    justifyContent: "center",
    alignItems: "center",
    flexShrink: 0,
  },

  bar: {
    display: "block",
    width: "22px",
    height: "2px",
    background: "#1C1C1C",
    borderRadius: "2px",
    transition: "all 0.3s ease",
  },
};

/* ================= MEDIA QUERIES ================= */

const mediaQueries = `
  @media (max-width: 1200px) {
    /* Adjust padding for tablets and smaller screens */
  }

  @media (max-width: 768px) {
    /* Show hamburger menu on tablets and mobile */
    .navbar-hamburger {
      display: flex !important;
    }

    /* Hide desktop nav links */
    .navbar-links {
      display: none !important;
    }

    /* Show mobile nav when menu is open */
    .navbar-links.mobile-show {
      display: flex !important;
    }
  }

  @media (max-width: 480px) {
    /* Extra small phones */
    .navbar-hamburger {
      display: flex !important;
    }

    .navbar-links {
      display: none !important;
    }

    .navbar-links.mobile-show {
      display: flex !important;
      gap: 6px;
    }
  }

  @media (max-width: 360px) {
    /* Very small phones (e.g., iPhone SE) */
    .navbar-hamburger {
      display: flex !important;
      padding: 6px 2px !important;
    }

    .navbar-links {
      display: none !important;
    }

    .navbar-links.mobile-show {
      display: flex !important;
      padding: 10px 12px !important;
    }
  }

  /* Landscape mode adjustments */
  @media (max-height: 500px) and (orientation: landscape) {
    nav {
      height: 56px;
    }
  }

  /* Touch device optimizations */
  @media (hover: none) and (pointer: coarse) {
    button, a {
      min-height: 44px;
      min-width: 44px;
    }
  }

  /* High DPI screens */
  @media (min-resolution: 2dppx) {
    .navbar-hamburger span {
      border-radius: 1px;
    }
  }

  /* Prevent zoom on iPhone */
  @media (max-width: 768px) {
    input, button, select {
      font-size: 16px;
    }
  }
`;

export default Navbar;