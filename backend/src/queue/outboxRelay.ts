import pool from "../db/pool";
import { enqueueJob } from "./messageQueue";

export interface OutboxEventInput {
  aggregateType: string;
  aggregateId: string;
  eventType: "NOTIFICATION" | "AUDIT" | "EMAIL_DISPATCH" | "REMINDER";
  payload: Record<string, any>;
}

export async function insertOutboxEvent(
  client: { query: Function },
  event: OutboxEventInput
): Promise<string> {
  const res = await client.query(
    `INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [event.aggregateType, event.aggregateId, event.eventType, JSON.stringify(event.payload)]
  );
  return res.rows[0].id;
}

export async function processOutboxEvents(batchSize: number = 50): Promise<number> {
  const client = await pool.connect();
  let processedCount = 0;

  try {
    await client.query("BEGIN");

    const res = await client.query(
      `SELECT id, aggregate_type, aggregate_id, event_type, payload
       FROM outbox_events
       WHERE status = 'PENDING'
       ORDER BY created_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      [batchSize]
    );

    for (const row of res.rows) {
      const eventPayload = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;

      const jobOptions: any = {
        jobId: eventPayload.jobKey || `outbox_${row.id}`,
      };
      if (row.event_type === "REMINDER" && eventPayload.delayMs) {
        const elapsed = Date.now() - new Date(row.created_at).getTime();
        jobOptions.delay = Math.max(0, Number(eventPayload.delayMs) - elapsed);
      }

      // Make BullMQ job idempotent by passing outbox event ID as the BullMQ jobId
      await enqueueJob(row.event_type, eventPayload, jobOptions);

      await client.query(
        `UPDATE outbox_events
         SET status = 'SENT', processed_at = NOW()
         WHERE id = $1`,
        [row.id]
      );

      processedCount++;
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[OutboxRelay] Error processing outbox events:", err);
    throw err;
  } finally {
    client.release();
  }

  return processedCount;
}

let relayTimer: NodeJS.Timeout | null = null;
let isRelayRunning = false;

export function startOutboxRelay(intervalMs: number = 1000) {
  if (relayTimer) return;

  relayTimer = setInterval(async () => {
    if (isRelayRunning) return;
    isRelayRunning = true;
    try {
      await processOutboxEvents();
    } catch {
      // Ignored to prevent timer termination
    } finally {
      isRelayRunning = false;
    }
  }, intervalMs);

  console.log(`[OutboxRelay] Transactional outbox relay started (polling every ${intervalMs}ms).`);
}

export function stopOutboxRelay() {
  if (relayTimer) {
    clearInterval(relayTimer);
    relayTimer = null;
  }
}
