import { Module, Global } from '@nestjs/common';
import { PrismaService } from './database/prisma.service';
import { RedisService } from './redis/redis.service';
import { HealthController } from './health/health.controller';

@Global()
@Module({
  controllers: [HealthController],
  providers: [PrismaService, RedisService],
  exports: [PrismaService, RedisService],
})
export class PlatformModule {}
