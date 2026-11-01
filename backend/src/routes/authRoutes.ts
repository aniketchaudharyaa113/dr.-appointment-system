import { Router } from "express";
import { signup, login } from "../controllers/authController";
import { loginRateLimiter } from "../middleware/rateLimiter";
import { validate } from "../middleware/validate";
import { signupSchema, loginSchema } from "../schemas/validationSchemas";

const router = Router();

router.post("/signup", validate({ body: signupSchema }), signup);
router.post("/login", loginRateLimiter, validate({ body: loginSchema }), login);

export default router;
