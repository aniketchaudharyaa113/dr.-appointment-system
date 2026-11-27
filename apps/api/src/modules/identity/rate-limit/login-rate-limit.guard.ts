import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { RedisService } from '../../platform/redis/redis.service';

const ATOMIC_INCR_EXPIRE_LUA = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
end
local ttl = redis.call('TTL', KEYS[1])
return { current, ttl }
`;

interface BucketEntry {
  count: number;
  resetAtMs: number;
}

@Injectable()
export class LoginRateLimitGuard implements CanActivate {
  private readonly fallbackBuckets = new Map<string, BucketEntry>();

  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  private consumeFallback(key: string, windowSeconds: number): [number, number] {
    const now = Date.now();
    const existing = this.fallbackBuckets.get(key);
    if (!existing || existing.resetAtMs <= now) {
      const resetAtMs = now + windowSeconds * 1000;
      this.fallbackBuckets.set(key, { count: 1, resetAtMs });
      return [1, windowSeconds];
    }
    existing.count += 1;
    const ttl = Math.max(1, Math.ceil((existing.resetAtMs - now) / 1000));
    return [existing.count, ttl];
  }

  private async incrementCounter(
    key: string,
    windowSeconds: number,
  ): Promise<[number, number]> {
    const client = this.redis.getClient();
    if (!client) {
      return this.consumeFallback(key, windowSeconds);
    }

    try {
      const result = (await client.eval(
        ATOMIC_INCR_EXPIRE_LUA,
        1,
        key,
        String(windowSeconds),
      )) as [number, number];
      return [Number(result?.[0] ?? 0), Math.max(1, Number(result?.[1] ?? windowSeconds))];
    } catch {
      // Fail closed against brute-force attacks by enforcing strict in-memory limits if Redis errors
      return this.consumeFallback(key, windowSeconds);
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const body = (request.body as Record<string, any>) || {};
    const email = (body.email as string)?.toLowerCase().trim() || 'unknown';
    const ip = request.ip || 'unknown-ip';

    const checks: Array<{ key: string; limit: number; windowSeconds: number }> = [
      // Strict per-(IP, email) burst limit
      { key: `ratelimit:login:${ip}:${email}`, limit: 5, windowSeconds: 60 },
      // Per-account limit across all IPs to mitigate distributed credential stuffing
      { key: `ratelimit:login:acct:${email}`, limit: 10, windowSeconds: 300 },
      // Per-IP limit across all emails to mitigate horizontal spraying
      { key: `ratelimit:login:ip:${ip}`, limit: 20, windowSeconds: 60 },
    ];

    for (const check of checks) {
      const [current, ttl] = await this.incrementCounter(check.key, check.windowSeconds);
      if (current > check.limit) {
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: `Too many login attempts. Please try again in ${ttl} seconds.`,
            error: 'Too Many Requests',
            retryAfter: ttl,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    return true;
  }
}
