import { Router } from "express";
import {
  getPendingDoctors,
  verifyDoctor,
  getAllAppointments,
  getStats,
  getAuditLogs,
} from "../controllers/adminController";
import { verifyToken, requireRole } from "../middleware/authMiddleware";

const router = Router();

router.use(verifyToken, requireRole("ADMIN"));

router.get("/doctors/pending", getPendingDoctors);
router.patch("/doctors/:id/verify", verifyDoctor);
router.get("/appointments", getAllAppointments);
router.get("/stats", getStats);
router.get("/audit-logs", getAuditLogs);

export default router;
