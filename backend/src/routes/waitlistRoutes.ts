import { Router } from "express";
import { joinWaitlist, getMyWaitlists, leaveWaitlist } from "../controllers/waitlistController";
import { verifyToken, requireRole } from "../middleware/authMiddleware";
import { validate } from "../middleware/validate";
import { joinWaitlistSchema, uuidParamSchema } from "../schemas/validationSchemas";

const router = Router();

router.post(
  "/",
  verifyToken,
  requireRole("PATIENT"),
  validate({ body: joinWaitlistSchema }),
  joinWaitlist
);
router.get("/mine", verifyToken, requireRole("PATIENT"), getMyWaitlists);
router.delete(
  "/:id",
  verifyToken,
  requireRole("PATIENT"),
  validate({ params: uuidParamSchema }),
  leaveWaitlist
);

export default router;
