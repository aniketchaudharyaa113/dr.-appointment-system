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

import { notFound, errorHandler } from "./middleware/errorMiddleware";
import { initSocket } from "./sockets/slotEvents";

dotenv.config();

const app = express();
const httpServer = http.createServer(app);

app.use(cors({ origin: process.env.CLIENT_URL || "*" }));
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    message: "MediBook API is running",
    health: "/health",
    endpoints: {
      auth: ["/auth/signup", "/auth/login"],
      doctors: ["/doctors", "/doctors/:id", "/doctors/me", "/doctors/me/availability", "/doctors/me/earnings"],
      appointments: ["/appointments", "/appointments/mine", "/appointments/:id/cancel", "/appointments/:id/complete"],
      search: ["/search/symptom?q=...&lat=...&lng=..."],
      reviews: ["/reviews"],
      admin: ["/admin/doctors/pending", "/admin/doctors/:id/verify", "/admin/appointments", "/admin/stats"],
    },
  });
});

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.use("/auth", authRoutes);
app.use("/doctors", doctorRoutes);
app.use("/appointments", appointmentRoutes);
app.use("/search", searchRoutes);
app.use("/reviews", reviewRoutes);
app.use("/admin", adminRoutes);

app.use(notFound);
app.use(errorHandler);

initSocket(httpServer);

const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => {
  console.log(`MediBook backend running on http://localhost:${PORT}`);
});
