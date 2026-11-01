import { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger";

export function notFound(req: Request, res: Response) {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
}

// Catches any error passed to next(err) from a controller
export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  logger.error(
    { err, path: req.path, method: req.method },
    err.message || "Unhandled server error"
  );

  // Postgres unique constraint violation (e.g. double-booking a slot)
  if (err.code === "23505") {
    return res
      .status(409)
      .json({ error: "That slot was just booked by someone else. Please pick another." });
  }

  res.status(err.status || 500).json({ error: err.message || "Something went wrong" });
}
