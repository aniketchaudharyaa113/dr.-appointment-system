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

  it('prevents X-Forwarded-For leftmost IP spoofing (trustProxy: 1 uses rightmost hop) and rate-limits /auth/register', async () => {
    const payload = {
      email: 'spoof.target@test.com',
      password: 'WrongPassword123!',
    };

    // Attacker rotates spoofed leftmost IPs while connecting through proxy 203.0.113.9
    for (let i = 1; i <= 5; i++) {
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { 'x-forwarded-for': `1.2.3.${i}, 203.0.113.9` },
        payload,
      });
      expect(res.statusCode).toBe(401);
    }

    // 6th attempt with yet another spoofed leftmost IP is still blocked because rightmost hop is 203.0.113.9
    const blocked = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'x-forwarded-for': '9.9.9.9, 203.0.113.9' },
      payload,
    });
    expect(blocked.statusCode).toBe(429);

    // /auth/register rate limit (5 per 60s per IP)
    for (let i = 1; i <= 5; i++) {
      const regRes = await ctx.app.inject({
        method: 'POST',
        url: '/api/auth/register',
        headers: { 'x-forwarded-for': '198.51.100.42' },
        payload: {
          email: `reg_rl_${i}@test.com`,
          password: 'Password123!',
          name: 'Rate Limit User',
          role: 'PATIENT',
        },
      });
      expect(regRes.statusCode).toBe(201);
    }
    const regBlocked = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      headers: { 'x-forwarded-for': '198.51.100.42' },
      payload: {
        email: 'reg_rl_6@test.com',
        password: 'Password123!',
        fullName: 'Rate Limit User',
        role: 'PATIENT',
      },
    });
    expect(regBlocked.statusCode).toBe(429);
  });
});
