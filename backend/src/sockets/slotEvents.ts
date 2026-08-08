import { Server } from "socket.io";
import { Server as HttpServer } from "http";

let io: Server;

export function initSocket(httpServer: HttpServer) {
  io = new Server(httpServer, {
    cors: { origin: process.env.CLIENT_URL || "*" },
  });

  io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);
    socket.on("disconnect", () => console.log("Client disconnected:", socket.id));
  });

  return io;
}

// Lets controllers emit events without importing the whole socket setup
export function getIO(): Server {
  if (!io) throw new Error("Socket.io not initialized yet");
  return io;
}
