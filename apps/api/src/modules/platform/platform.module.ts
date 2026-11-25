import { Module, Global } from '@nestjs/common';
import { PrismaService } from './database/prisma.service';
import { RedisService } from './redis/redis.service';
import { HealthController } from './health/health.controller';
import { AuditService } from './audit/audit.service';
import { MetricsService } from './metrics/metrics.service';
import { MetricsController } from './metrics/metrics.controller';
import { NotificationsController } from './notifications/notifications.controller';
import { RealtimeService } from './realtime/realtime.service';

@Global()
@Module({
  controllers: [HealthController, MetricsController, NotificationsController],
  providers: [PrismaService, RedisService, AuditService, MetricsService, RealtimeService],
  exports: [PrismaService, RedisService, AuditService, MetricsService, RealtimeService],
})
export class PlatformModule {}
