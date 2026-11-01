import { Router } from "express";
import {
  createAppointment,
  getMyAppointments,
  cancelAppointment,
  completeAppointment,
  rescheduleAppointment,
} from "../controllers/appointmentController";
import { verifyToken, requireRole } from "../middleware/authMiddleware";

const router = Router();

router.post("/", verifyToken, requireRole("PATIENT"), createAppointment);
router.get("/mine", verifyToken, getMyAppointments);
router.patch("/:id/cancel", verifyToken, cancelAppointment);
router.patch("/:id/complete", verifyToken, requireRole("DOCTOR"), completeAppointment);
router.patch("/:id/reschedule", verifyToken, rescheduleAppointment);

export default router;
