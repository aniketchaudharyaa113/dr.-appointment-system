import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { FastifyReply } from 'fastify';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../redis/redis.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  @Get('live')
  @ApiOperation({ summary: 'Liveness probe endpoint' })
  @ApiResponse({ status: 200, description: 'Application process is alive' })
  getLiveness() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe verifying DB and Redis dependencies' })
  @ApiResponse({ status: 200, description: 'All dependencies are healthy' })
  @ApiResponse({ status: 503, description: 'One or more dependencies are unhealthy' })
  async getReadiness(@Res() res: FastifyReply) {
    let dbHealthy = false;
    let redisHealthy = false;

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      dbHealthy = true;
    } catch {
      dbHealthy = false;
    }

    try {
      redisHealthy = await this.redis.ping();
    } catch {
      redisHealthy = false;
    }

    const isHealthy = dbHealthy && redisHealthy;
    const statusCode = isHealthy
      ? HttpStatus.OK
      : HttpStatus.SERVICE_UNAVAILABLE;

    return res.status(statusCode).send({
      status: isHealthy ? 'ok' : 'degraded',
      db: dbHealthy,
      redis: redisHealthy,
      timestamp: new Date().toISOString(),
    });
  }
}
