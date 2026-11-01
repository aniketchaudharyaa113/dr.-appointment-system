import { Router } from "express";
import { signup, login, refreshToken, logout } from "../controllers/authController";
import { loginRateLimiter } from "../middleware/rateLimiter";
import { validate } from "../middleware/validate";
import { signupSchema, loginSchema } from "../schemas/validationSchemas";

const router = Router();

router.post("/signup", validate({ body: signupSchema }), signup);
router.post("/login", loginRateLimiter, validate({ body: loginSchema }), login);
router.post("/refresh", refreshToken);
router.post("/logout", logout);

export default router;
