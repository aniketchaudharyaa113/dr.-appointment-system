import express from "express";
import http from "http";
import cors from "cors";
import dotenv from "dotenv";

import authRoutes from "./routes/authRoutes";
import doctorRoutes from "./routes/doctorRoutes";
import appointmentRoutes from "./routes/appointmentRoutes";
import searchRoutes from "./routes/searchRoutes";
import reviewRoutes from "./routes/reviewRoutes";
import adminRoutes from "./routes/adminRoutes";
import prescriptionRoutes from "./routes/prescriptionRoutes";
import notificationRoutes from "./routes/notificationRoutes";

import { notFound, errorHandler } from "./middleware/errorMiddleware";
import { initSocket } from "./sockets/slotEvents";
import { initMessageQueue } from "./queue/messageQueue";
import { isRedisConnected } from "./cache/redis";
import pool from "./db/pool";

dotenv.config();

const app = express();
const httpServer = http.createServer(app);

app.use(cors({ origin: process.env.CLIENT_URL || "*" }));
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    message: "MediBook API is running",
    version: "2.0.0",
    health: "/health",
    services: {
      cache: isRedisConnected() ? "Redis (Active)" : "In-Memory Fallback",
      messageQueue: "Active",
    },
    endpoints: {
      auth: ["/auth/signup", "/auth/login"],
      doctors: [
        "/doctors",
        "/doctors/:id",
        "/doctors/me",
        "/doctors/me/availability",
        "/doctors/me/leaves",
        "/doctors/me/earnings",
      ],
      appointments: [
        "/appointments",
        "/appointments/mine",
        "/appointments/:id/cancel",
        "/appointments/:id/complete",
      ],
      prescriptions: [
        "/prescriptions",
        "/prescriptions/mine",
        "/prescriptions/appointment/:appointmentId",
      ],
      notifications: [
        "/notifications",
        "/notifications/:id/read",
        "/notifications/read-all",
      ],
      search: ["/search/symptom?q=...&lat=...&lng=..."],
      reviews: ["/reviews"],
      admin: [
        "/admin/doctors/pending",
        "/admin/doctors/:id/verify",
        "/admin/appointments",
        "/admin/stats",
        "/admin/audit-logs",
      ],
    },
  });
});

app.get("/health", async (req, res) => {
  let dbStatus = "ok";
  try {
    await pool.query("SELECT 1");
  } catch {
    dbStatus = "error";
  }

  res.json({
    status: dbStatus === "ok" ? "ok" : "degraded",
    database: dbStatus,
    redis: isRedisConnected() ? "connected" : "fallback_memory",
    timestamp: new Date().toISOString(),
  });
});

app.use("/auth", authRoutes);
app.use("/doctors", doctorRoutes);
app.use("/appointments", appointmentRoutes);
app.use("/prescriptions", prescriptionRoutes);
app.use("/notifications", notificationRoutes);
app.use("/search", searchRoutes);
app.use("/reviews", reviewRoutes);
app.use("/admin", adminRoutes);

app.use(notFound);
app.use(errorHandler);

// Initialize real-time WebSockets
initSocket(httpServer);

// Initialize background Message Queue
initMessageQueue();

const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => {
  console.log(`MediBook backend running on http://localhost:${PORT}`);
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("SIGTERM received, closing HTTP server and pool...");
  httpServer.close(async () => {
    await pool.end();
    process.exit(0);
  });
});
