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

@Injectable()
export class LoginRateLimitGuard implements CanActivate {
  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const body = (request.body as Record<string, any>) || {};
    const email = (body.email as string)?.toLowerCase().trim() || 'unknown';
    const ip =
      (request.headers['x-forwarded-for'] as string)?.split(',')[0].trim() ||
      request.ip ||
      'unknown-ip';

    const key = `ratelimit:login:${ip}:${email}`;
    const client = this.redis.getClient();

    if (!client) {
      // If redis is unavailable in unit test, proceed
      return true;
    }

    try {
      const current = await client.incr(key);
      if (current === 1) {
        await client.expire(key, 60); // 1-minute window
      }

      if (current > 5) {
        const ttl = await client.ttl(key);
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
