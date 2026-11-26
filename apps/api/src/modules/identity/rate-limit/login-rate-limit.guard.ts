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

@Injectable()
export class LoginRateLimitGuard implements CanActivate {
  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const body = (request.body as Record<string, any>) || {};
    const email = (body.email as string)?.toLowerCase().trim() || 'unknown';
    const ip = request.ip || 'unknown-ip';

    const key = `ratelimit:login:${ip}:${email}`;
    const client = this.redis.getClient();

    if (!client) {
      // If redis is unavailable in unit test, proceed
      return true;
    }

    try {
      const result = (await client.eval(
        ATOMIC_INCR_EXPIRE_LUA,
        1,
        key,
        '60',
      )) as [number, number];
      const current = Number(result?.[0] ?? 0);
      const ttl = Math.max(1, Number(result?.[1] ?? 60));

      if (current > 5) {
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
    } catch (err) {
      if (err instanceof HttpException) throw err;
      // In case of redis transient errors, fail open to avoid total lockout
    }

    return true;
  }
}
