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

import helmet from "helmet";

dotenv.config();

if (process.env.NODE_ENV === "production" && !process.env.CLIENT_URL) {
  throw new Error("Fatal: CLIENT_URL environment variable must be configured in production");
}

const app = express();
const httpServer = http.createServer(app);

app.use(helmet());

const allowedOrigins = process.env.CLIENT_URL
  ? process.env.CLIENT_URL.split(",").map((s) => s.trim())
  : [];

app.use(
  cors({
    origin: (origin, callback) => {
      // allow requests with no origin (e.g. mobile apps, curl, or same-origin)
      if (!origin) return callback(null, true);
      if (process.env.NODE_ENV !== "production") {
        return callback(null, true);
      }
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`CORS blocked: origin ${origin} not allowed`));
    },
    credentials: true,
  })
);
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

export { app, httpServer };
export default app;
