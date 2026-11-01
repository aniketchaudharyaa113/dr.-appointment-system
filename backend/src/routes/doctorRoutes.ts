import { Router } from "express";
import {
  getDoctors,
  getDoctorById,
  getMyProfile,
  updateMyProfile,
  setAvailability,
  getMyEarnings,
  getBookedSlots,
  addDoctorLeave,
  removeDoctorLeave,
} from "../controllers/doctorController";
import { verifyToken, requireRole } from "../middleware/authMiddleware";

const router = Router();

// Public
router.get("/", getDoctors);

// Doctor-only routes (must come before /:id)
router.get("/me", verifyToken, requireRole("DOCTOR"), getMyProfile);
router.patch("/me", verifyToken, requireRole("DOCTOR"), updateMyProfile);
router.patch("/me/availability", verifyToken, requireRole("DOCTOR"), setAvailability);
router.post("/me/leaves", verifyToken, requireRole("DOCTOR"), addDoctorLeave);
router.delete("/me/leaves/:date", verifyToken, requireRole("DOCTOR"), removeDoctorLeave);
router.get("/me/earnings", verifyToken, requireRole("DOCTOR"), getMyEarnings);

// Public (must come after /me routes)
router.get("/:id", getDoctorById);
router.get("/:id/booked-slots", getBookedSlots);

export default router;
