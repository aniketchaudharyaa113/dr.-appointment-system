import { Router } from "express";
import {
  createAppointment,
  getMyAppointments,
  cancelAppointment,
  completeAppointment,
  rescheduleAppointment,
  markNoShow,
  holdSlot,
  releaseHold,
} from "../controllers/appointmentController";
import { verifyToken, requireRole } from "../middleware/authMiddleware";
import { validate } from "../middleware/validate";
import {
  createAppointmentSchema,
  cancelAppointmentSchema,
  completeAppointmentSchema,
  rescheduleAppointmentSchema,
  noShowAppointmentSchema,
  appointmentsQuerySchema,
  uuidParamSchema,
  holdSlotSchema,
  releaseHoldSchema,
} from "../schemas/validationSchemas";

import { idempotency } from "../middleware/idempotency";

const router = Router();

router.post(
  "/hold",
  verifyToken,
  requireRole("PATIENT"),
  validate({ body: holdSlotSchema }),
  holdSlot
);
router.post(
  "/release-hold",
  verifyToken,
  requireRole("PATIENT"),
  validate({ body: releaseHoldSchema }),
  releaseHold
);
router.post(
  "/",
  verifyToken,
  requireRole("PATIENT"),
  idempotency(),
  validate({ body: createAppointmentSchema }),
  createAppointment
);
router.get("/mine", verifyToken, validate({ query: appointmentsQuerySchema }), getMyAppointments);
router.patch(
  "/:id/cancel",
  verifyToken,
  validate({ params: uuidParamSchema, body: cancelAppointmentSchema }),
  cancelAppointment
);
router.patch(
  "/:id/complete",
  verifyToken,
  requireRole("DOCTOR"),
  validate({ params: uuidParamSchema, body: completeAppointmentSchema }),
  completeAppointment
);
router.patch(
  "/:id/no-show",
  verifyToken,
  requireRole("DOCTOR"),
  validate({ params: uuidParamSchema, body: noShowAppointmentSchema }),
  markNoShow
);
router.patch(
  "/:id/reschedule",
  verifyToken,
  validate({ params: uuidParamSchema, body: rescheduleAppointmentSchema }),
  rescheduleAppointment
);

export default router;
