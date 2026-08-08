import { Router } from "express";
import {
  getDoctors, getDoctorById, getMyProfile, updateMyProfile, setAvailability, getMyEarnings, getBookedSlots,
} from "../controllers/doctorController";
import { verifyToken, requireRole } from "../middleware/authMiddleware";

const router = Router();

// Public
router.get("/", getDoctors);

// Doctor-only
// IMPORTANT: these /me routes must be registered BEFORE "/:id" below.
// Express matches routes in the order they're defined, and "/:id" would
// otherwise greedily match "/me" as if "me" were a doctor's id.
router.get("/me", verifyToken, requireRole("DOCTOR"), getMyProfile);
router.patch("/me", verifyToken, requireRole("DOCTOR"), updateMyProfile);
router.patch("/me/availability", verifyToken, requireRole("DOCTOR"), setAvailability);
router.get("/me/earnings", verifyToken, requireRole("DOCTOR"), getMyEarnings);

// Public (must come after /me routes)
router.get("/:id", getDoctorById);
router.get("/:id/booked-slots", getBookedSlots);

export default router;
