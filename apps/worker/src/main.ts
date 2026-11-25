import * as http from 'http';
import * as dotenv from 'dotenv';
import pino from 'pino';
import { PrismaClient } from '@prisma/client';
import { createMailer } from './mailer.js';
import { WorkerEngine } from './worker-engine.js';

dotenv.config();

const logger = pino({
  level: process.env.NODE_ENV === 'test' ? 'silent' : 'info',
});

async function bootstrap() {
  const databaseUrl = process.env.DATABASE_URL;
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for worker');
  }

  const prisma = new PrismaClient();
  await prisma.$connect();

  const mailer = createMailer({
    host: process.env.SMTP_HOST || 'localhost',
    port: Number(process.env.SMTP_PORT || 1025),
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  });

  const engine = new WorkerEngine({
    prisma,
    redisUrl,
    mailer,
    logger,
  });

  await engine.scheduleExpiryCheck();

  const pollIntervalMs = Number(process.env.OUTBOX_POLL_INTERVAL_MS || 1000);
  let polling = false;
  const pollTimer = setInterval(async () => {
    if (polling) return;
    polling = true;
    try {
      await engine.pollOutboxOnce(50);
    } catch (err: any) {
      logger.error({ err: err.message }, 'Outbox relay poll error');
    } finally {
      polling = false;
    }
  }, pollIntervalMs);

  // Metrics & Health server on port 4001 (internal Prometheus target)
  const metricsPort = Number(process.env.WORKER_METRICS_PORT || 4001);
  const metricsServer = http.createServer(async (req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'medibook-worker' }));
      return;
    }
    if (req.url === '/metrics') {
      const [outboxCounts, dlqCounts] = await Promise.all([
        engine.outboxQueue.getJobCounts(),
        engine.dlqQueue.getJobCounts(),
      ]);
      const lines = [
        '# HELP medibook_worker_outbox_waiting Outbox jobs waiting in BullMQ',
        '# TYPE medibook_worker_outbox_waiting gauge',
        `medibook_worker_outbox_waiting ${outboxCounts.waiting ?? 0}`,
        '# HELP medibook_worker_dlq_total Total jobs in dead-letter queue',
        '# TYPE medibook_worker_dlq_total gauge',
        `medibook_worker_dlq_total ${(dlqCounts.waiting ?? 0) + (dlqCounts.completed ?? 0)}`,
      ].join('\n');
      res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
      res.end(lines + '\n');
      return;
    }
    res.writeHead(404);
    res.end();
  });

  metricsServer.listen(metricsPort, '0.0.0.0', () => {
    logger.info({ metricsPort }, 'MediBook Worker started and polling outbox');
  });

  const shutdown = async () => {
    logger.info('Shutting down MediBook Worker gracefully...');
    clearInterval(pollTimer);
    metricsServer.close();
    await engine.close(false);
    await mailer.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

bootstrap().catch((err) => {
  logger.fatal({ err }, 'Worker failed to start');
  process.exit(1);
});
