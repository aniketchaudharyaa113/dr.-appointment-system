import { io } from "socket.io-client";

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

let socket;

// Lazily creates one shared socket connection for the whole app.
export function getSocket() {
  if (!socket) {
    socket = io(BASE_URL, { autoConnect: true });
  }
  return socket;
}
