import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { Bell, CheckCheck, ExternalLink } from "lucide-react";
import { api } from "../lib/api";
import { getSocket } from "../lib/socket";
import { useAuth } from "../context/AuthContext";

export default function NotificationBell() {
  const { user, token } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);

  function load() {
    if (!token) return;
    api.getMyNotifications(token)
      .then((data) => {
        setNotifications(data.notifications || []);
        setUnreadCount(data.unreadCount || 0);
      })
      .catch(() => {});
  }

  useEffect(() => {
    load();
  }, [token]);

  // Real-time socket notification listener
  useEffect(() => {
    if (!user || !user.id) return;
    const socket = getSocket();
    const eventName = `notification:${user.id}`;

    function onNewNotification(item) {
      setNotifications((prev) => [item, ...prev.slice(0, 29)]);
      setUnreadCount((c) => c + 1);
    }

    socket.on(eventName, onNewNotification);
    return () => {
      socket.off(eventName, onNewNotification);
    };
  }, [user]);

  // Close panel on outside click
  useEffect(() => {
    function handleClickOutside(e) {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function handleMarkRead(id) {
    try {
      await api.markNotificationAsRead(id, token);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
      );
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch {}
  }

  async function handleMarkAllRead() {
    try {
      await api.markAllNotificationsAsRead(token);
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      setUnreadCount(0);
    } catch {}
  }

  if (!user) return null;

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen(!open)}
        aria-label="Notifications"
        className="relative p-2 text-inkSoft hover:text-ink transition-colors rounded-full hover:bg-black/5"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-clay-500 text-[10px] font-bold text-white shadow-sm">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 sm:w-96 rounded-xl border border-line bg-white p-3 shadow-xl z-50 animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="flex items-center justify-between border-b border-line pb-2 mb-2 px-1">
            <span className="font-display font-semibold text-sm text-ink">
              Notifications {unreadCount > 0 && `(${unreadCount})`}
            </span>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="flex items-center gap-1 text-xs text-sage-600 hover:text-sage-700 font-medium"
              >
                <CheckCheck className="w-3.5 h-3.5" /> Mark all read
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto space-y-2 divide-y divide-line/60">
            {notifications.length === 0 ? (
              <p className="py-6 text-center text-xs text-inkSoft">No notifications yet.</p>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  onClick={() => !n.is_read && handleMarkRead(n.id)}
                  className={`pt-2 first:pt-0 pb-1 px-1 transition-colors ${
                    !n.is_read ? "bg-sage-50/50 rounded-lg p-2" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-semibold text-ink">{n.title}</p>
                    <span className="font-mono text-[10px] text-inkSoft whitespace-nowrap">
                      {new Date(n.created_at).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-inkSoft leading-relaxed">{n.message}</p>
                  {n.link && (
                    <Link
                      to={n.link}
                      onClick={() => setOpen(false)}
                      className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-sage-600 hover:underline"
                    >
                      View details <ExternalLink className="w-3 h-3" />
                    </Link>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
