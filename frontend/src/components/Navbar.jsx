import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate("/");
  }

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-paper/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link to="/" className="font-display text-xl font-semibold tracking-tight text-ink">
          MediBook
        </Link>

        <nav className="flex items-center gap-6 text-sm font-medium text-inkSoft">
          <Link to="/doctors" className="hover:text-ink">Find a doctor</Link>

          {!user && (
            <>
              <Link to="/login" className="hover:text-ink">Log in</Link>
              <Link to="/signup" className="btn-primary !px-4 !py-2">Sign up</Link>
            </>
          )}

          {user?.role === "PATIENT" && (
            <Link to="/my-appointments" className="hover:text-ink">My appointments</Link>
          )}
          {user?.role === "DOCTOR" && (
            <Link to="/doctor/dashboard" className="hover:text-ink">Dashboard</Link>
          )}
          {user?.role === "ADMIN" && (
            <Link to="/admin" className="hover:text-ink">Admin</Link>
          )}

          {user && (
            <button onClick={handleLogout} className="btn-secondary !px-4 !py-2">
              Log out
            </button>
          )}
        </nav>
      </div>
    </header>
  );
}
