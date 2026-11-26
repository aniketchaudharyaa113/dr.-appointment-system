import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Inject,
} from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { FastifyRequest } from 'fastify';
import { env } from '../../../common/config/env.schema';
import { JwtPayload } from '@medibook/shared';
import { PrismaService } from '../../platform/database/prisma.service';
import { RedisService } from '../../platform/redis/redis.service';
import { isUserActiveCached } from '../utils/user-active.util';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const authHeader = request.headers.authorization;

    let token: string | undefined;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else if ((request as any).cookies && (request as any).cookies.accessToken) {
      token = (request as any).cookies.accessToken;
    }

    if (!token) {
      throw new UnauthorizedException('Authentication token required');
    }

    let decoded: JwtPayload;
    try {
      decoded = jwt.verify(token, env.JWT_SECRET, {
        algorithms: ['HS256'],
      }) as JwtPayload;
    } catch {
      throw new UnauthorizedException('Invalid or expired authentication token');
    }

    const active = await isUserActiveCached(this.prisma, this.redis, decoded.sub);
    if (!active) {
      throw new UnauthorizedException('User account is inactive');
    }

    (request as any).user = decoded;
    return true;
  }
}
