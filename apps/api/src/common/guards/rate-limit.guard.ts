import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FastifyRequest } from 'fastify';
import { RedisService } from '../../modules/platform/redis/redis.service';

export const RATE_LIMIT_KEY = 'medibook_rate_limit';

export interface RateLimitOptions {
  keyPrefix: string;
  limit: number;
  windowSeconds: number;
}

export const RateLimit = (options: RateLimitOptions) =>
  SetMetadata(RATE_LIMIT_KEY, options);

const ATOMIC_INCR_EXPIRE_LUA = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
end
local ttl = redis.call('TTL', KEYS[1])
return { current, ttl }
`;

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<RateLimitOptions>(
      RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!options) return true;

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const userId = (request as any).user?.sub as string | undefined;
    const ip = request.ip || 'unknown-ip';
    const actor = userId ? `u:${userId}:ip:${ip}` : `ip:${ip}`;
    const key = `ratelimit:${options.keyPrefix}:${actor}`;

    const client = this.redis.getClient();
    if (!client) return true;

    try {
      const result = (await client.eval(
        ATOMIC_INCR_EXPIRE_LUA,
        1,
        key,
        String(options.windowSeconds),
      )) as [number, number];
      const current = Number(result?.[0] ?? 0);
      const ttl = Math.max(1, Number(result?.[1] ?? options.windowSeconds));

      if (current > options.limit) {
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: `Rate limit exceeded. Please try again in ${ttl} seconds.`,
            error: 'Too Many Requests',
            retryAfter: ttl,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    } catch (err) {
      if (err instanceof HttpException) throw err;
    }

    return true;
  }
}
