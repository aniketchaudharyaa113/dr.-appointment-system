import { Router } from "express";
import {
  getDoctors,
  getDoctorById,
  getMyProfile,
  updateMyProfile,
  setAvailability,
  getMyEarnings,
  getDayView,
  getBookedSlots,
  addDoctorLeave,
  removeDoctorLeave,
} from "../controllers/doctorController";
import { getDoctorHeldSlots } from "../controllers/appointmentController";
import { verifyToken, requireRole } from "../middleware/authMiddleware";
import { validate } from "../middleware/validate";
import {
  doctorQuerySchema,
  updateAvailabilitySchema,
  createLeaveSchema,
  dayViewQuerySchema,
  uuidParamSchema,
} from "../schemas/validationSchemas";

const router = Router();

// Public
router.get("/", validate({ query: doctorQuerySchema }), getDoctors);

// Doctor-only routes (must come before /:id)
router.get("/me", verifyToken, requireRole("DOCTOR"), getMyProfile);
router.patch("/me", verifyToken, requireRole("DOCTOR"), updateMyProfile);
router.patch(
  "/me/availability",
  verifyToken,
  requireRole("DOCTOR"),
  validate({ body: updateAvailabilitySchema }),
  setAvailability
);
router.put(
  "/me/availability",
  verifyToken,
  requireRole("DOCTOR"),
  validate({ body: updateAvailabilitySchema }),
  setAvailability
);
router.post(
  "/me/leaves",
  verifyToken,
  requireRole("DOCTOR"),
  validate({ body: createLeaveSchema }),
  addDoctorLeave
);
router.delete("/me/leaves/:date", verifyToken, requireRole("DOCTOR"), removeDoctorLeave);
router.get("/me/day-view", verifyToken, requireRole("DOCTOR"), validate({ query: dayViewQuerySchema }), getDayView);
router.get("/me/earnings", verifyToken, requireRole("DOCTOR"), getMyEarnings);

// Public (must come after /me routes)
router.get("/:id", validate({ params: uuidParamSchema }), getDoctorById);
router.get("/:id/booked-slots", validate({ params: uuidParamSchema }), getBookedSlots);
router.get("/:id/held-slots", validate({ params: uuidParamSchema }), getDoctorHeldSlots);

export default router;
