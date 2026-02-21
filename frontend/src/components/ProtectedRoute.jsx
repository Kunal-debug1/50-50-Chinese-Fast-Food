import { Navigate } from "react-router-dom";
import { useHotel } from "../context/HotelContext";

function ProtectedRoute({ children }) {
  const { selectedTable } = useHotel();

  if (!selectedTable) {
    return <Navigate to="/tables" replace />;
  }

  return children;
}

export default ProtectedRoute;
