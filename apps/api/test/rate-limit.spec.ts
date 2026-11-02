import { describe, it, expect } from 'vitest';
import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { LoginRateLimitGuard } from '../src/modules/identity/rate-limit/login-rate-limit.guard';
import { RedisService } from '../src/modules/platform/redis/redis.service';

describe('Login Rate Limiter (IP + Email Protection)', () => {
  it('permits up to 5 attempts and rejects the 6th with 429 Too Many Requests', async () => {
    let callCount = 0;

    const mockRedisClient = {
      incr: async (_key: string) => ++callCount,
      expire: async (_key: string, _ttl: number) => 1,
      ttl: async (_key: string) => 45,
    };

    const mockRedisService = {
      getClient: () => mockRedisClient,
    } as unknown as RedisService;

    const guard = new LoginRateLimitGuard(mockRedisService);

    const createCtx = (email: string, ip: string): ExecutionContext =>
      ({
        switchToHttp: () => ({
          getRequest: () => ({
            body: { email },
            headers: { 'x-forwarded-for': ip },
          }),
        }),
      }) as unknown as ExecutionContext;

    const ctx = createCtx('patient.bruteforce@test.com', '192.168.1.100');

    // Attempts 1 to 5 should all pass
    for (let i = 1; i <= 5; i++) {
      const allowed = await guard.canActivate(ctx);
      expect(allowed).toBe(true);
    }

    // 6th attempt must be rejected with 429
    await expect(guard.canActivate(ctx)).rejects.toThrow(HttpException);

    try {
      await guard.canActivate(ctx);
    } catch (err: any) {
      expect(err.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      const res = err.getResponse();
      expect(res.message).toContain('Too many login attempts');
      expect(res.retryAfter).toBe(45);
    }
  });
});
