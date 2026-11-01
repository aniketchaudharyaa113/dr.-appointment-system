import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { startTestEnvironment, stopTestEnvironment } from "./setup";

describe("Phase 2 - Task 2.2: Helmet, Strict CORS & Redis-backed Rate Limiter", () => {
  beforeAll(async () => {
    await startTestEnvironment();
  });

  afterAll(async () => {
    await stopTestEnvironment();
  });

  it("applies helmet security headers to responses", async () => {
    const res = await request(app).get("/health");
    expect(res.headers).toHaveProperty("x-dns-prefetch-control");
    expect(res.headers).toHaveProperty("x-content-type-options", "nosniff");
  });

  it("enforces rate limit of 5 login attempts per minute per IP+email, returning 429 on 6th", async () => {
    const testEmail = `ratelimit.${Date.now()}@medibook.test`;
    const payload = { email: testEmail, password: "wrongpassword" };

    // Send 5 rapid login requests
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post("/auth/login")
        .send(payload);
      // Status should be 401 (invalid credentials), not 429
      expect(res.status).toBe(401);
    }

    // 6th attempt should be blocked by express-rate-limit with 429
    const blockedRes = await request(app)
      .post("/auth/login")
      .send(payload);

    expect(blockedRes.status).toBe(429);
    expect(blockedRes.body.message).toContain("Too many login attempts");
  });
});
