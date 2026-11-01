import { Server, Socket } from "socket.io";
import { Server as HttpServer } from "http";
import jwt from "jsonwebtoken";
import { createAdapter } from "@socket.io/redis-adapter";
import { Emitter } from "@socket.io/redis-emitter";
import Redis from "ioredis";
import { logger } from "../lib/logger";
import { activeSocketConnections } from "../metrics/prometheus";

let io: Server | null = null;
let adapterPub: Redis | null = null;
let adapterSub: Redis | null = null;

let emitterClient: Redis | null = null;
let redisEmitter: Emitter | null = null;

export function getRedisEmitter(): Emitter {
  if (!redisEmitter) {
    const url = process.env.REDIS_URL || "redis://localhost:6379";
    emitterClient = new Redis(url, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      retryStrategy(times) {
        if (times > 5) return null;
        return Math.min(times * 100, 1000);
      },
    });
    emitterClient.on("error", () => {});
    redisEmitter = new Emitter(emitterClient);
  }
  return redisEmitter;
}

export function initSocket(httpServer: HttpServer, customRedisUrl?: string) {
  io = new Server(httpServer, {
    cors: { origin: process.env.CLIENT_URL || "*" },
  });

  const redisUrl = customRedisUrl || process.env.REDIS_URL;
  if (redisUrl) {
    try {
      adapterPub = new Redis(redisUrl, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        retryStrategy(times) {
          if (times > 5) return null;
          return Math.min(times * 100, 1000);
        },
      });
      adapterSub = adapterPub.duplicate();

      adapterPub.on("error", () => {});
      adapterSub.on("error", () => {});

      io.adapter(createAdapter(adapterPub, adapterSub));
      logger.info("[Socket.IO] Redis adapter attached successfully.");
    } catch (err: any) {
      logger.warn({ err: err?.message || err }, "[Socket.IO] Redis adapter init failed, using default in-memory adapter");
    }
  }

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
    try { activeSocketConnections.inc(); } catch {}

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

    socket.on("disconnect", () => {
      try { activeSocketConnections.dec(); } catch {}
    });
  });

  return io;
}

// Lets controllers emit events without importing the whole socket setup
export function getIO(): Server {
  if (!io) throw new Error("Socket.io not initialized yet");
  return io;
}

export async function closeSocket(): Promise<void> {
  if (io) {
    io.close();
    io = null;
  }
  if (adapterPub) {
    await adapterPub.quit();
    adapterPub = null;
  }
  if (adapterSub) {
    await adapterSub.quit();
    adapterSub = null;
  }
  if (emitterClient) {
    await emitterClient.quit();
    emitterClient = null;
    redisEmitter = null;
  }
}
