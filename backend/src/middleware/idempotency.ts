import { Request, Response, NextFunction } from "express";
import { getRedisClient, isRedisConnected } from "../cache/redis";

export function idempotency(prefix = "idempotency:appointment:") {
  return async (req: Request, res: Response, next: NextFunction) => {
    const key = (req.headers["idempotency-key"] || req.headers["x-idempotency-key"]) as
      string | undefined;

    if (!key) {
      if (
        process.env.NODE_ENV === "production" ||
        req.headers["x-enforce-idempotency"] === "true"
      ) {
        return res.status(400).json({ error: "Idempotency-Key header is required" });
      }
      return next();
    }

    const redis = getRedisClient();
    if (!redis || !isRedisConnected()) {
      return next();
    }

    const cacheKey = `${prefix}${key}`;
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        res.setHeader("X-Idempotent-Replay", "true");
        return res.status(parsed.status).json(parsed.body);
      }
    } catch (err: any) {
      console.warn(`[Idempotency] Error reading key "${cacheKey}":`, err?.message || err);
    }

    // Intercept res.json to store successful responses in Redis for 24h
    const originalJson = res.json.bind(res);
    res.json = (body: any) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        try {
          redis
            .set(cacheKey, JSON.stringify({ status: res.statusCode, body }), "EX", 86400)
            .catch(() => {});
        } catch {}
      }
      return originalJson(body);
    };

    next();
  };
}
