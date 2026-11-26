import { PrismaClient, Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import type { Logger } from 'pino';

export interface OutboxRow {
  id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  payload: unknown;
}

/**
 * Polls pending outbox events with FOR UPDATE SKIP LOCKED, publishes each to BullMQ
 * with jobId = event.id (for idempotent deduplication), and marks it PUBLISHED inside
 * the same DB transaction so Redis outages leave events PENDING for subsequent retries.
 */
export async function pollAndPublishOutbox(
  prisma: PrismaClient,
  outboxQueue: Queue,
  logger: Logger,
  options: {
    batchSize?: number;
    maxAttempts?: number;
    backoffDelayMs?: number;
  } = {},
): Promise<number> {
  const batchSize = options.batchSize ?? 50;
  const maxAttempts = options.maxAttempts ?? 3;
  const backoffDelayMs = options.backoffDelayMs ?? 500;

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const rows = await tx.$queryRaw<OutboxRow[]>`
      SELECT id, aggregate_type, aggregate_id, event_type, payload
      FROM outbox_events
      WHERE status = 'PENDING'
      ORDER BY created_at ASC
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    `;

    if (rows.length === 0) {
      return 0;
    }

    let published = 0;

    for (const row of rows) {
      await outboxQueue.add(
        row.event_type,
        {
          outboxEventId: row.id,
          aggregateType: row.aggregate_type,
          aggregateId: row.aggregate_id,
          eventType: row.event_type,
          payload: row.payload,
        },
        {
          jobId: row.id,
          attempts: maxAttempts,
          backoff: {
            type: 'exponential',
            delay: backoffDelayMs,
          },
          removeOnComplete: false,
          removeOnFail: false,
        },
      );

      await tx.$executeRaw`
        UPDATE outbox_events
        SET status = 'PUBLISHED', processed_at = NOW()
        WHERE id = ${row.id}::uuid
      `;

      published++;
    }

    logger.info({ published }, 'Published outbox batch to BullMQ');
    return published;
  });
}
