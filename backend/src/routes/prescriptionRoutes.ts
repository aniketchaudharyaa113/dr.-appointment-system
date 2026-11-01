import { Router } from "express";
import {
  createPrescription,
  getPrescriptionByAppointment,
  getMyPrescriptions,
  getPrescriptionVersions,
} from "../controllers/prescriptionController";
import { verifyToken, requireRole } from "../middleware/authMiddleware";
import { validate } from "../middleware/validate";
import {
  createPrescriptionSchema,
  appointmentIdParamSchema,
} from "../schemas/validationSchemas";
import { z } from "zod";

const router = Router();

router.use(verifyToken);

router.post(
  "/",
  requireRole("DOCTOR"),
  validate({ body: createPrescriptionSchema }),
  createPrescription
);
router.get("/mine", requireRole("PATIENT"), getMyPrescriptions);
router.get(
  "/appointment/:appointmentId",
  validate({ params: appointmentIdParamSchema }),
  getPrescriptionByAppointment
);
router.get(
  "/:prescriptionId/versions",
  validate({ params: z.object({ prescriptionId: z.string().uuid() }) }),
  getPrescriptionVersions
);

export default router;
