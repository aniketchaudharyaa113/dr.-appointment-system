import { Router } from "express";
import {
  getPendingDoctors,
  verifyDoctor,
  getAllAppointments,
  getStats,
  getAuditLogs,
} from "../controllers/adminController";
import { verifyToken, requireRole } from "../middleware/authMiddleware";
import { validate } from "../middleware/validate";
import {
  uuidParamSchema,
  verifyDoctorSchema,
  adminAppointmentsQuerySchema,
  paginationQuerySchema,
} from "../schemas/validationSchemas";

const router = Router();

router.use(verifyToken, requireRole("ADMIN"));

router.get("/doctors/pending", getPendingDoctors);
router.patch(
  "/doctors/:id/verify",
  validate({ params: uuidParamSchema, body: verifyDoctorSchema }),
  verifyDoctor
);
router.get("/appointments", validate({ query: adminAppointmentsQuerySchema }), getAllAppointments);
router.get("/stats", getStats);
router.get("/audit-logs", validate({ query: paginationQuerySchema }), getAuditLogs);

export default router;
