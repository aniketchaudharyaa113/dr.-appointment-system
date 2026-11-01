import { describe, it, expect, beforeAll, afterAll } from "vitest";
import jwt from "jsonwebtoken";
import { io as Client, Socket as ClientSocket } from "socket.io-client";
import { httpServer } from "../src/app";
import { getIO } from "../src/sockets/slotEvents";
import { startTestEnvironment, stopTestEnvironment } from "./setup";

describe("Phase 2 - Task 2.1: Socket.IO Authentication & Room Isolation", () => {
  let port: number;
  let userAToken: string;
  let userBToken: string;
  const userAId = "11111111-1111-1111-1111-111111111111";
  const userBId = "22222222-2222-2222-2222-222222222222";

  beforeAll(async () => {
    await startTestEnvironment();

    const secret = process.env.JWT_SECRET as string;
    userAToken = jwt.sign({ id: userAId, role: "PATIENT" }, secret, { expiresIn: "1h" });
    userBToken = jwt.sign({ id: userBId, role: "PATIENT" }, secret, { expiresIn: "1h" });

    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        const addr = httpServer.address();
        if (typeof addr === "object" && addr) {
          port = addr.port;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });
    await stopTestEnvironment();
  });

  function connectSocket(opts: any): Promise<ClientSocket> {
    return new Promise((resolve, reject) => {
      const socket = Client(`http://localhost:${port}`, {
        transports: ["websocket"],
        timeout: 5000,
        ...opts,
      });
      socket.on("connect", () => resolve(socket));
      socket.on("connect_error", (err) => reject(err));
    });
  }

  it("authenticates and isolates notifications between users", async () => {
    const clientA = await connectSocket({ auth: { token: userAToken } });
    const clientB = await connectSocket({ auth: { token: userBToken } });

    let userAReceivedNotification: any = null;
    let userBReceivedNotification: any = null;

    clientA.on("notification", (data) => {
      userAReceivedNotification = data;
    });

    clientB.on("notification", (data) => {
      userBReceivedNotification = data;
    });

    // Also verify legacy channel isolation
    clientB.on(`notification:${userAId}`, (data) => {
      userBReceivedNotification = data;
    });

    // Emit notification targeting only user A's room
    getIO().to(`user:${userAId}`).emit("notification", { id: "notif-1", title: "Secret for A" });

    // Wait a brief moment for socket message delivery
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(userAReceivedNotification).toEqual({ id: "notif-1", title: "Secret for A" });
    expect(userBReceivedNotification).toBeNull();

    clientA.disconnect();
    clientB.disconnect();
  });

  it("allows public slot viewers to watch and unwatch doctor rooms", async () => {
    const publicClient = await connectSocket({});

    const doctorId = "doctor-uuid-123";
    publicClient.emit("watch-doctor", doctorId);
    await new Promise((resolve) => setTimeout(resolve, 100));

    let slotEventReceived: any = null;
    publicClient.on("slot-booked", (data) => {
      slotEventReceived = data;
    });

    // Emit to doctor room
    getIO().to(`doctor:${doctorId}`).emit("slot-booked", { doctorId, slotTime: "2027-05-10 10:00:00" });
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(slotEventReceived).toEqual({ doctorId, slotTime: "2027-05-10 10:00:00" });

    // Unwatch doctor
    publicClient.emit("unwatch-doctor", doctorId);
    await new Promise((resolve) => setTimeout(resolve, 100));

    slotEventReceived = null;
    getIO().to(`doctor:${doctorId}`).emit("slot-booked", { doctorId, slotTime: "2027-05-10 10:30:00" });
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Should not receive event after unwatch
    expect(slotEventReceived).toBeNull();

    publicClient.disconnect();
  });

  it("rejects connection with invalid token", async () => {
    const invalidClient = Client(`http://localhost:${port}`, {
      auth: { token: "invalid.token.signature" },
      transports: ["websocket"],
      reconnection: false,
    });

    const errorPromise = new Promise<string>((resolve) => {
      invalidClient.on("connect_error", (err) => resolve(err.message));
    });

    const errMessage = await errorPromise;
    expect(errMessage).toContain("Authentication error");
    invalidClient.disconnect();
  });
});
