import { Router } from "express";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { getAllQueues } from "../queue/messageQueue";
import { verifyToken, requireRole } from "../middleware/authMiddleware";

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath("/admin/queues");

let isBoardCreated = false;

export function getBullBoardRouter(): Router {
  if (!isBoardCreated) {
    const queues = getAllQueues();
    createBullBoard({
      queues: queues.map((q) => new BullMQAdapter(q)),
      serverAdapter,
    });
    isBoardCreated = true;
  }
  return serverAdapter.getRouter();
}

const queueRouter = Router();

// Mount at /admin/queues - ADMIN only
queueRouter.use(verifyToken, requireRole("ADMIN"), (req, res, next) => {
  return getBullBoardRouter()(req, res, next);
});

export default queueRouter;
