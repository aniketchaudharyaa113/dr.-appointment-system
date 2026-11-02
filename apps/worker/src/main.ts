import { Worker, Queue } from 'bullmq';
import Redis from 'ioredis';
import * as dotenv from 'dotenv';
import pino from 'pino';

dotenv.config();

const logger = pino({
  level: process.env.NODE_ENV === 'test' ? 'silent' : 'info',
  transport:
    process.env.NODE_ENV === 'development'
      ? {
          target: 'pino-pretty',
          options: { colorize: true },
        }
      : undefined,
});

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const connection = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
});

logger.info('Starting MediBook Standalone Worker...');

export const outboxQueue = new Queue('outbox-queue', { connection });
export const paymentQueue = new Queue('payment-processing', { connection });
export const notificationQueue = new Queue('notifications', { connection });

// Outbox Worker
export const outboxWorker = new Worker(
  'outbox-queue',
  async (job) => {
    logger.info({ jobId: job.id, name: job.name }, 'Processing outbox event');
    return { success: true };
  },
  { connection },
);

// Payment Processing Worker
export const paymentWorker = new Worker(
  'payment-processing',
  async (job) => {
    logger.info({ jobId: job.id, name: job.name }, 'Processing payment job');
    return { success: true };
  },
  { connection },
);

// Notification Worker
export const notificationWorker = new Worker(
  'notifications',
  async (job) => {
    logger.info({ jobId: job.id, name: job.name }, 'Dispatching notification');
    return { success: true };
  },
  { connection },
);

logger.info('MediBook Worker listeners initialized and ready');

process.on('SIGTERM', async () => {
  logger.info('Gracefully closing workers...');
  await Promise.all([
    outboxWorker.close(),
    paymentWorker.close(),
    notificationWorker.close(),
  ]);
  await connection.quit();
  process.exit(0);
});
