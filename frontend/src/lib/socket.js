import { io } from "socket.io-client";

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

let socket = null;

// Lazily creates one shared socket connection with JWT auth
export function getSocket(token) {
  if (!socket) {
    const activeToken = token || localStorage.getItem("medibook_token");
    socket = io(BASE_URL, {
      auth: { token: activeToken || undefined },
      autoConnect: true,
    });
  }
  return socket;
}

// Reconnects socket with new token on login or unauthenticated on logout
export function reconnectSocket(newToken) {
  if (socket) {
    socket.disconnect();
  }
  socket = io(BASE_URL, {
    auth: { token: newToken || undefined },
    autoConnect: true,
  });
  return socket;
}
