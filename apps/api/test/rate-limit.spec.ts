import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  bootTestApp,
  resetDatabaseAndRedis,
  TestContext,
} from './helpers/test-app';

describe('Login Rate Limiter (Real Redis + HTTP /api/auth/login)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await bootTestApp();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await resetDatabaseAndRedis(ctx.prisma, ctx.redisClient);
  });

  it('permits up to 5 attempts and rejects the 6th with 429 Too Many Requests using real Redis counters', async () => {
    const payload = {
      email: 'patient.bruteforce@test.com',
      password: 'WrongPassword123!',
    };

    for (let i = 1; i <= 5; i++) {
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { 'x-forwarded-for': '192.168.1.100' },
        payload,
      });
      expect(res.statusCode).toBe(401);
    }

    const sixth = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'x-forwarded-for': '192.168.1.100' },
      payload,
    });
    expect(sixth.statusCode).toBe(429);
    const body = sixth.json();
    expect(body.message).toContain('Too many login attempts');
    expect(body.details.retryAfter).toBeGreaterThan(0);

    // Separate IP for same email resets its own counter independently
    const otherIp = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'x-forwarded-for': '10.0.0.55' },
      payload,
    });
    expect(otherIp.statusCode).toBe(401);
  });
});
