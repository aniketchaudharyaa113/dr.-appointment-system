import { Router } from "express";
import {
  createPrescription,
  getPrescriptionByAppointment,
  getMyPrescriptions,
} from "../controllers/prescriptionController";
import { verifyToken, requireRole } from "../middleware/authMiddleware";

const router = Router();

router.use(verifyToken);

router.post("/", requireRole("DOCTOR"), createPrescription);
router.get("/mine", requireRole("PATIENT"), getMyPrescriptions);
router.get("/appointment/:appointmentId", getPrescriptionByAppointment);

export default router;
