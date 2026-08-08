import { Router } from "express";
import { createReview } from "../controllers/reviewController";
import { verifyToken, requireRole } from "../middleware/authMiddleware";

const router = Router();

router.post("/", verifyToken, requireRole("PATIENT"), createReview);

export default router;
