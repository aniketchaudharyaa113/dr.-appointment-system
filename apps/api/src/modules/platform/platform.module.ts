import { Module, Global } from '@nestjs/common';
import { PrismaService } from './database/prisma.service';
import { RedisService } from './redis/redis.service';
import { HealthController } from './health/health.controller';
import { AuditService } from './audit/audit.service';

@Global()
@Module({
  controllers: [HealthController],
  providers: [PrismaService, RedisService, AuditService],
  exports: [PrismaService, RedisService, AuditService],
})
export class PlatformModule {}
