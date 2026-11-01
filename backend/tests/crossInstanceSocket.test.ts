import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "http";
import express from "express";
import { io as ClientSocket } from "socket.io-client";
import jwt from "jsonwebtoken";
import { startTestEnvironment, stopTestEnvironment } from "./setup";
import { initSocket, getRedisEmitter } from "../src/sockets/slotEvents";
import { Server as SocketIOServer } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import Redis from "ioredis";

describe("Phase 4 - Task 4.2: Cross-Instance Real-Time Delivery with Redis Adapter", () => {
  let redisUrl: string;
  let server1: http.Server;
  let server2: http.Server;
  let port1: number;
  let port2: number;
  let io1: SocketIOServer;
  let io2: SocketIOServer;
  let redisPub1: Redis;
  let redisSub1: Redis;
  let redisPub2: Redis;
  let redisSub2: Redis;

  const JWT_SECRET = "test-jwt-secret-key-32-characters-minimum";

  beforeAll(async () => {
    const env = await startTestEnvironment();
    redisUrl = env.redisUrl;

    // Instance 1
    const app1 = express();
    server1 = http.createServer(app1);
    io1 = new SocketIOServer(server1, { cors: { origin: "*" } });
    redisPub1 = new Redis(redisUrl, { maxRetriesPerRequest: null });
    redisSub1 = redisPub1.duplicate();
    io1.adapter(createAdapter(redisPub1, redisSub1));

    // Attach same auth handshake logic as production
    io1.use((socket, next) => {
      const token = socket.handshake.auth?.token;
      if (token) {
        try {
          socket.data.user = jwt.verify(token, JWT_SECRET);
        } catch {}
      }
      next();
    });

    io1.on("connection", (socket) => {
      if (socket.data.user?.id) {
        socket.join(`user:${socket.data.user.id}`);
      }
      socket.on("watch-doctor", (docId) => socket.join(`doctor:${docId}`));
    });

    // Instance 2
    const app2 = express();
    server2 = http.createServer(app2);
    io2 = new SocketIOServer(server2, { cors: { origin: "*" } });
    redisPub2 = new Redis(redisUrl, { maxRetriesPerRequest: null });
    redisSub2 = redisPub2.duplicate();
    io2.adapter(createAdapter(redisPub2, redisSub2));

    io2.use((socket, next) => {
      const token = socket.handshake.auth?.token;
      if (token) {
        try {
          socket.data.user = jwt.verify(token, JWT_SECRET);
        } catch {}
      }
      next();
    });

    io2.on("connection", (socket) => {
      if (socket.data.user?.id) {
        socket.join(`user:${socket.data.user.id}`);
      }
      socket.on("watch-doctor", (docId) => socket.join(`doctor:${docId}`));
    });

    await new Promise<void>((resolve) => server1.listen(0, () => resolve()));
    await new Promise<void>((resolve) => server2.listen(0, () => resolve()));

    port1 = (server1.address() as any).port;
    port2 = (server2.address() as any).port;
  });

  afterAll(async () => {
    await io1.close();
    await io2.close();
    await new Promise<void>((resolve) => server1.close(() => resolve()));
    await new Promise<void>((resolve) => server2.close(() => resolve()));
    await redisPub1.quit();
    await redisSub1.quit();
    await redisPub2.quit();
    await redisSub2.quit();
    await stopTestEnvironment();
  });

  it("proves cross-instance broadcast: client connected to Instance 1 receives booking event emitted from Instance 2", async () => {
    const doctorId = "doc-cross-instance-123";

    // 1. Client connects strictly to Server 1
    const client1 = ClientSocket(`http://127.0.0.1:${port1}`, {
      transports: ["websocket"],
      forceNew: true,
    });

    await new Promise<void>((resolve, reject) => {
      client1.on("connect", () => resolve());
      client1.on("connect_error", (err) => reject(err));
    });

    // Client 1 watches doctor
    client1.emit("watch-doctor", doctorId);
    await new Promise((r) => setTimeout(r, 100)); // small delay for room join

    // 2. Set up listener on Client 1
    const receivedEventPromise = new Promise<{ doctorId: string; slotTime: string }>((resolve) => {
      client1.on("slot-booked", (data) => {
        resolve(data);
      });
    });

    // 3. Server 2 handles booking and emits event into doctor room
    io2.to(`doctor:${doctorId}`).emit("slot-booked", {
      doctorId,
      slotTime: "2026-11-15 14:00:00",
    });

    const receivedData = await receivedEventPromise;
    expect(receivedData).toBeDefined();
    expect(receivedData.doctorId).toBe(doctorId);
    expect(receivedData.slotTime).toBe("2026-11-15 14:00:00");

    client1.disconnect();
  });

  it("proves isolated user notification across instances via redis-emitter", async () => {
    const targetUserId = "user-cross-replica-999";
    const userToken = jwt.sign({ id: targetUserId, role: "PATIENT" }, JWT_SECRET);

    // Client connects to Server 1 with authenticated token
    const clientUser = ClientSocket(`http://127.0.0.1:${port1}`, {
      transports: ["websocket"],
      auth: { token: userToken },
      forceNew: true,
    });

    await new Promise<void>((resolve, reject) => {
      clientUser.on("connect", () => resolve());
      clientUser.on("connect_error", (err) => reject(err));
    });

    const notificationPromise = new Promise<{ title: string; message: string }>((resolve) => {
      clientUser.on("notification", (data) => resolve(data));
    });

    // Worker or Instance 2 emits through Redis Emitter
    const emitter = getRedisEmitter();
    emitter.to(`user:${targetUserId}`).emit("notification", {
      title: "Cross Replica Alert",
      message: "Delivered seamlessly across backend instances via Redis pub/sub",
    });

    const notification = await notificationPromise;
    expect(notification.title).toBe("Cross Replica Alert");
    expect(notification.message).toContain("Delivered seamlessly");

    clientUser.disconnect();
  });
});
