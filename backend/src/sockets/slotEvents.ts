import { Server, Socket } from "socket.io";
import { Server as HttpServer } from "http";
import jwt from "jsonwebtoken";

let io: Server;

export function initSocket(httpServer: HttpServer) {
  io = new Server(httpServer, {
    cors: { origin: process.env.CLIENT_URL || "*" },
  });

  // Verify JWT in the handshake middleware
  io.use((socket: Socket, next) => {
    const token =
      socket.handshake.auth?.token ||
      (socket.handshake.headers.authorization
        ? socket.handshake.headers.authorization.replace(/^Bearer\s+/, "")
        : null);

    if (token) {
      try {
        const decoded = jwt.verify(
          token,
          process.env.JWT_SECRET || "fallback_secret_not_for_prod"
        ) as { id: string; role: string };
        socket.data.user = decoded;
      } catch (err) {
        return next(new Error("Authentication error: invalid or expired token"));
      }
    }
    next();
  });

  io.on("connection", (socket: Socket) => {
    const user = socket.data.user;
    if (user && user.id) {
      socket.join(`user:${user.id}`);
      if (user.role) {
        socket.join(`role:${user.role}`);
      }
    }

    // Public or authenticated slot viewers join specific doctor room
    socket.on("watch-doctor", (doctorId: string) => {
      if (doctorId && typeof doctorId === "string") {
        socket.join(`doctor:${doctorId}`);
      }
    });

    socket.on("unwatch-doctor", (doctorId: string) => {
      if (doctorId && typeof doctorId === "string") {
        socket.leave(`doctor:${doctorId}`);
      }
    });
  });

  return io;
}

// Lets controllers emit events without importing the whole socket setup
export function getIO(): Server {
  if (!io) throw new Error("Socket.io not initialized yet");
  return io;
}
