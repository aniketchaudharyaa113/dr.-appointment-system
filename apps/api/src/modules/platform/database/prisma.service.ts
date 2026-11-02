import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { logger } from '../../../common/logger/pino-logger.service';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit() {
    try {
      await this.$connect();
      logger.info('Connected to PostgreSQL database via Prisma');
    } catch (error) {
      logger.error({ err: error }, 'Failed to connect to PostgreSQL database');
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
    logger.info('Disconnected from PostgreSQL database');
  }
}
