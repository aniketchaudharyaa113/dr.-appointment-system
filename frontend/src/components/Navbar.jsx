import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import NotificationBell from "./NotificationBell";

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate("/");
  }

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-paper/95 backdrop-blur shadow-sm">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
        <Link to="/" className="flex items-center gap-2 group">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sage-600 text-white font-display font-bold text-lg shadow-sm group-hover:bg-sage-700 transition-colors">
            +
          </div>
          <span className="font-display text-xl font-bold tracking-tight text-ink">
            MediBook
          </span>
        </Link>

        <nav className="flex items-center gap-4 sm:gap-6 text-sm font-medium text-inkSoft">
          <Link to="/doctors" className="hover:text-ink transition-colors">
            Find a doctor
          </Link>

          {!user && (
            <>
              <Link to="/login" className="hover:text-ink transition-colors">
                Log in
              </Link>
              <Link to="/signup" className="btn-primary !px-4 !py-2">
                Sign up
              </Link>
            </>
          )}

          {user?.role === "PATIENT" && (
            <Link to="/my-appointments" className="hover:text-ink transition-colors">
              My visits
            </Link>
          )}
          {user?.role === "DOCTOR" && (
            <Link to="/doctor/dashboard" className="hover:text-ink transition-colors">
              Doctor portal
            </Link>
          )}
          {user?.role === "ADMIN" && (
            <Link to="/admin" className="hover:text-ink transition-colors">
              Admin
            </Link>
          )}

          {user && (
            <div className="flex items-center gap-3 border-l border-line pl-3">
              <NotificationBell />
              <div className="hidden sm:flex flex-col text-right">
                <span className="text-xs font-semibold text-ink leading-tight">{user.name}</span>
                <span className="text-[10px] font-mono text-sage-600 uppercase tracking-wider">{user.role}</span>
              </div>
              <button onClick={handleLogout} className="btn-secondary !px-3 !py-1.5 text-xs">
                Log out
              </button>
            </div>
          )}
        </nav>
      </div>
    </header>
  );
}
