import { Router } from "express";
import {
  getMyNotifications,
  markAsRead,
  markAllAsRead,
} from "../controllers/notificationController";
import { verifyToken } from "../middleware/authMiddleware";
import { validate } from "../middleware/validate";
import { paginationQuerySchema, uuidParamSchema } from "../schemas/validationSchemas";

const router = Router();

router.use(verifyToken);

router.get("/", validate({ query: paginationQuerySchema }), getMyNotifications);
router.patch("/:id/read", validate({ params: uuidParamSchema }), markAsRead);
router.patch("/read-all", markAllAsRead);

export default router;
