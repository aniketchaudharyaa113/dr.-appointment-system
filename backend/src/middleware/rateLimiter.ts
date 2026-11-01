import rateLimit from "express-rate-limit";
import RedisStore from "rate-limit-redis";
import { getRedisClient } from "../cache/redis";

export const loginRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // 5 attempts per minute per IP + email
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  validate: { keyGeneratorIpFallback: false },
  keyGenerator: (req) => {
    const ip = req.ip || req.socket.remoteAddress || "127.0.0.1";
    const email = req.body?.email ? String(req.body.email).toLowerCase().trim() : "anonymous";
    return `${ip}:${email}`;
  },
  store: new RedisStore({
    // @ts-expect-error sendCommand signature in rate-limit-redis
    sendCommand: async (...args: string[]) => {
      const client = getRedisClient();
      if (!client) {
        throw new Error("Redis client unavailable");
      }
      return (client as any).call(...args);
    },
    prefix: "rl:login:",
  }),
  message: {
    message: "Too many login attempts. Please try again after 1 minute.",
  },
});
