import { Router } from "express";
import { signup, login } from "../controllers/authController";
import { loginRateLimiter } from "../middleware/rateLimiter";

const router = Router();

router.post("/signup", signup);
router.post("/login", loginRateLimiter, login);

export default router;
