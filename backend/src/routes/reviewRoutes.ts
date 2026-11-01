import { Router } from "express";
import { createReview } from "../controllers/reviewController";
import { verifyToken, requireRole } from "../middleware/authMiddleware";
import { validate } from "../middleware/validate";
import { createReviewSchema } from "../schemas/validationSchemas";

const router = Router();

router.post(
  "/",
  verifyToken,
  requireRole("PATIENT"),
  validate({ body: createReviewSchema }),
  createReview
);

export default router;
