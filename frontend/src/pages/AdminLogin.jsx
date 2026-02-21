import { useState } from "react";
import { useNavigate } from "react-router-dom";

function AdminLogin() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const handleLogin = async () => {
    if (!username || !password) {
      setError("Please enter username and password");
      return;
    }

    try {
      setLoading(true);
      setError("");

      const res = await fetch("http://localhost:5000/admin/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username,
          password,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        localStorage.setItem("adminToken", data.access_token);
        navigate("/admin");
      } else {
        setError(data.message || "Invalid credentials");
      }
    } catch (err) {
      setError("Connection error. Please try again.");
      console.error("Login error:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter") {
      handleLogin();
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.loginCard}>
        {/* HEADER */}
        <div style={styles.header}>
          <h1 style={styles.title}>Admin Login</h1>
          <p style={styles.subtitle}>Restaurant Management System</p>
        </div>

        {/* ERROR MESSAGE */}
        {error && (
          <div style={styles.errorAlert}>
            <span style={styles.errorIcon}>⚠️</span>
            <span style={styles.errorText}>{error}</span>
          </div>
        )}

        {/* FORM */}
        <div style={styles.form}>
          <div style={styles.inputGroup}>
            <label style={styles.label}>Username</label>
            <input
              type="text"
              placeholder="Enter your username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyPress={handleKeyPress}
              style={styles.input}
              disabled={loading}
              autoFocus
            />
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>Password</label>
            <input
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyPress={handleKeyPress}
              style={styles.input}
              disabled={loading}
            />
          </div>

          <button
            style={{
              ...styles.loginBtn,
              opacity: loading ? 0.7 : 1,
              cursor: loading ? "not-allowed" : "pointer",
            }}
            onClick={handleLogin}
            disabled={loading}
            onMouseEnter={(e) => !loading && (e.target.style.opacity = "0.9")}
            onMouseLeave={(e) => !loading && (e.target.style.opacity = "1")}
          >
            {loading ? (
              <>
                <span style={styles.spinner}></span>
                Logging in...
              </>
            ) : (
              "Login"
            )}
          </button>
        </div>

        {/* FOOTER */}
        <div style={styles.footer}>
          <p style={styles.footerText}>
            Need help? Contact support@restaurant.com
          </p>
        </div>
      </div>

      <style>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(-20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

const styles = {
  container: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "100vh",
    background: "linear-gradient(135deg, #F8F8F8 0%, #FFFFFF 100%)",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    padding: "20px",
  },

  loginCard: {
    background: "#FFFFFF",
    borderRadius: "12px",
    boxShadow: "0 10px 40px rgba(0, 0, 0, 0.08)",
    padding: "40px",
    width: "100%",
    maxWidth: "400px",
    animation: "fadeIn 0.4s ease-out",
    border: "1px solid #E8E8E8",
  },

  header: {
    textAlign: "center",
    marginBottom: "30px",
  },

  title: {
    fontSize: "28px",
    fontWeight: "700",
    color: "#1C1C1C",
    margin: "0 0 8px 0",
  },

  subtitle: {
    fontSize: "13px",
    color: "#9C9C9C",
    margin: 0,
    fontWeight: "500",
  },

  errorAlert: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "12px 16px",
    background: "#FFEBEE",
    border: "1px solid #FFCDD2",
    borderRadius: "6px",
    marginBottom: "24px",
  },

  errorIcon: {
    fontSize: "16px",
  },

  errorText: {
    fontSize: "13px",
    color: "#C62828",
    fontWeight: "500",
  },

  form: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
    marginBottom: "20px",
  },

  inputGroup: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },

  label: {
    fontSize: "12px",
    fontWeight: "600",
    color: "#636363",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
  },

  input: {
    padding: "12px 14px",
    borderRadius: "6px",
    border: "1px solid #E8E8E8",
    fontSize: "14px",
    fontFamily: "inherit",
    transition: "all 0.2s ease",
    background: "#F8F8F8",
  },

  loginBtn: {
    padding: "12px",
    borderRadius: "6px",
    border: "none",
    background: "#FFD700",
    color: "#1C1C1C",
    fontSize: "14px",
    fontWeight: "700",
    cursor: "pointer",
    transition: "all 0.2s ease",
    marginTop: "8px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    letterSpacing: "0.5px",
  },

  spinner: {
    width: "12px",
    height: "12px",
    border: "2px solid #1C1C1C",
    borderTop: "2px solid transparent",
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
  },

  footer: {
    textAlign: "center",
    borderTop: "1px solid #E8E8E8",
    paddingTop: "20px",
  },

  footerText: {
    fontSize: "12px",
    color: "#9C9C9C",
    margin: 0,
  },
};

export default AdminLogin;