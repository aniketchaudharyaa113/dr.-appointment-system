import { Module, Global } from '@nestjs/common';
import { PrismaService } from './database/prisma.service';
import { RedisService } from './redis/redis.service';
import { HealthController } from './health/health.controller';
import { AuditService } from './audit/audit.service';
import { MetricsService } from './metrics/metrics.service';
import { MetricsController } from './metrics/metrics.controller';

@Global()
@Module({
  controllers: [HealthController, MetricsController],
  providers: [PrismaService, RedisService, AuditService, MetricsService],
  exports: [PrismaService, RedisService, AuditService, MetricsService],
})
export class PlatformModule {}
