import { Navigate } from "react-router-dom";

function AdminProtectedRoute({ children }) {
  const token = localStorage.getItem("adminToken");

  if (!token) {
    return <Navigate to="/admin-login" />;
  }

  return children;
}

export default AdminProtectedRoute;
