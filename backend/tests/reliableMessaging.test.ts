import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Queue, Worker } from "bullmq";
import { startTestEnvironment, stopTestEnvironment } from "./setup";
import { createRedisConnection, closeMessageQueue, getQueues } from "../src/queue/messageQueue";
import { insertOutboxEvent, processOutboxEvents } from "../src/queue/outboxRelay";
import { Pool } from "pg";

describe("Phase 3 - Task 3.7: Reliable Messaging and Transactional Outbox", () => {
  let pool: Pool;
  let redisUrl: string;

  beforeAll(async () => {
    const env = await startTestEnvironment();
    pool = env.pool;
    redisUrl = env.redisUrl;
  });

  afterAll(async () => {
    await closeMessageQueue();
    await stopTestEnvironment();
  });

  it("simulates worker failure with automatic retry and eventual success", async () => {
    const queueName = `test_retry_${Date.now()}`;
    const testQueue = new Queue(queueName, {
      connection: createRedisConnection(redisUrl),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "fixed", delay: 100 },
        removeOnComplete: false,
        removeOnFail: false,
      },
    });

    let attemptCount = 0;
    const worker = new Worker(
      queueName,
      async () => {
        attemptCount++;
        if (attemptCount === 1) {
          throw new Error("Simulated transient network glitch");
        }
        return { success: true, processedAttempt: attemptCount };
      },
      {
        connection: createRedisConnection(redisUrl),
      }
    );

    const job = await testQueue.add("transient_task", { payload: "retry_test" });

    // Wait for job completion
    await new Promise<void>((resolve, reject) => {
      worker.on("completed", (completedJob) => {
        if (completedJob.id === job.id) resolve();
      });
      worker.on("failed", (failedJob, err) => {
        if (failedJob?.id === job.id && failedJob.attemptsMade >= 3) {
          reject(err);
        }
      });
    });

    const refreshedJob = await testQueue.getJob(job.id!);
    expect(refreshedJob).toBeDefined();
    expect(refreshedJob?.attemptsMade).toBe(2);
    expect(attemptCount).toBe(2);

    await worker.close();
    await testQueue.close();
  });

  it("moves a poison job that exhausts all retries into the Dead Letter Queue (DLQ / failed state)", async () => {
    const queueName = `test_dlq_${Date.now()}`;
    const testQueue = new Queue(queueName, {
      connection: createRedisConnection(redisUrl),
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: "fixed", delay: 50 },
        removeOnComplete: false,
        removeOnFail: false,
      },
    });

    let executionCount = 0;
    const worker = new Worker(
      queueName,
      async () => {
        executionCount++;
        throw new Error("Fatal unrecoverable poison payload");
      },
      {
        connection: createRedisConnection(redisUrl),
      }
    );

    const job = await testQueue.add("poison_task", { malicious: true });

    // Wait until job permanently fails all retries
    await new Promise<void>((resolve) => {
      worker.on("failed", (failedJob) => {
        if (failedJob?.id === job.id && failedJob.attemptsMade >= 2) {
          resolve();
        }
      });
    });

    const failedJob = await testQueue.getJob(job.id!);
    expect(failedJob).toBeDefined();
    expect(failedJob?.attemptsMade).toBe(2);
    expect(executionCount).toBe(2);

    const failedReason = failedJob?.failedReason;
    expect(failedReason).toContain("Fatal unrecoverable poison payload");

    const failedJobs = await testQueue.getFailed();
    expect(failedJobs.length).toBeGreaterThanOrEqual(1);
    expect(failedJobs.some((j) => j.id === job.id)).toBe(true);

    await worker.close();
    await testQueue.close();
  });

  it("proves transactional outbox durability: DB commit persists event and relay delivers even after enqueuing delay", async () => {
    const client = await pool.connect();
    let outboxId: string = "";

    try {
      await client.query("BEGIN");

      // 1. Insert patient and doctor mock records if needed
      const userRes = await client.query(
        `INSERT INTO users (email, password, name, role)
         VALUES ($1, 'hashed_pw', 'Outbox Test Patient', 'PATIENT')
         RETURNING id`,
        [`outbox_pat_${Date.now()}@medibook.test`]
      );
      const patientId = userRes.rows[0].id;

      // 2. Insert outbox row within the SAME transaction
      outboxId = await insertOutboxEvent(client, {
        aggregateType: "APPOINTMENT",
        aggregateId: "mock-appointment-id",
        eventType: "NOTIFICATION",
        payload: {
          userId: patientId,
          type: "BOOKING_CONFIRMED",
          title: "Outbox Confirmed",
          message: "Transaction outbox message is safe",
        },
      });

      // 3. Commit the transaction
      await client.query("COMMIT");
    } finally {
      client.release();
    }

    expect(outboxId).toBeDefined();

    // Verify row exists in PostgreSQL with status PENDING
    const initialCheck = await pool.query(
      `SELECT status, processed_at FROM outbox_events WHERE id = $1`,
      [outboxId]
    );
    expect(initialCheck.rows.length).toBe(1);
    expect(initialCheck.rows[0].status).toBe("PENDING");
    expect(initialCheck.rows[0].processed_at).toBeNull();

    // 4. Run outbox relay to process pending events
    const processed = await processOutboxEvents(10);
    expect(processed).toBeGreaterThanOrEqual(1);

    // Verify outbox row status transitioned to SENT
    const updatedCheck = await pool.query(
      `SELECT status, processed_at FROM outbox_events WHERE id = $1`,
      [outboxId]
    );
    expect(updatedCheck.rows[0].status).toBe("SENT");
    expect(updatedCheck.rows[0].processed_at).not.toBeNull();

    // 5. Verify BullMQ received the job with idempotent outbox jobId
    const { notificationsQueue } = getQueues();
    const bullJob = await notificationsQueue.getJob(`outbox_${outboxId}`);
    expect(bullJob).toBeDefined();
    expect(bullJob?.data.title).toBe("Outbox Confirmed");
  });
});
