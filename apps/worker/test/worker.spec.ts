import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { GenericContainer, Wait } from 'testcontainers';
import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import pino from 'pino';
import { execSync } from 'child_process';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { createMailer, type Mailer } from '../src/mailer.js';
import { pollAndPublishOutbox } from '../src/outbox-relay.js';
import { WorkerEngine } from '../src/worker-engine.js';

const logger = pino({ level: 'silent' });

async function waitUntil(
  fn: () => Promise<boolean>,
  timeoutMs = 15000,
  intervalMs = 150,
) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for condition`);
}

describe('Slice 2: Real Outbox Relay, BullMQ Workers, Mailpit, Reminders, Crash Recovery & DLQ', () => {
  let pgContainer: any;
  let redisContainer: any;
  let mailpitContainer: any;

  let databaseUrl: string;
  let redisUrl: string;
  let mailpitApiUrl: string;
  let smtpHost: string;
  let smtpPort: number;

  let prisma: PrismaClient;
  let redisClient: Redis;
  let mailer: Mailer;

  beforeAll(async () => {
    pgContainer = await new GenericContainer('pgvector/pgvector:pg16')
      .withEnvironment({
        POSTGRES_USER: 'postgres',
        POSTGRES_PASSWORD: 'postgrespassword',
        POSTGRES_DB: 'medibook_worker_test',
      })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forListeningPorts())
      .start();

    redisContainer = await new GenericContainer('redis:7-alpine')
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forListeningPorts())
      .start();

    mailpitContainer = await new GenericContainer('axllent/mailpit:latest')
      .withExposedPorts(1025, 8025)
      .withWaitStrategy(Wait.forListeningPorts())
      .start();

    databaseUrl = `postgresql://postgres:postgrespassword@${pgContainer.getHost()}:${pgContainer.getMappedPort(5432)}/medibook_worker_test?schema=public`;
    redisUrl = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`;
    smtpHost = mailpitContainer.getHost();
    smtpPort = mailpitContainer.getMappedPort(1025);
    mailpitApiUrl = `http://${mailpitContainer.getHost()}:${mailpitContainer.getMappedPort(8025)}/api/v1`;

    const apiDir = path.resolve(__dirname, '../../api');
    execSync('npx prisma migrate deploy', {
      cwd: apiDir,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'inherit',
    });

    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await prisma.$connect();
    redisClient = new Redis(redisUrl, { maxRetriesPerRequest: null });
    mailer = createMailer({ host: smtpHost, port: smtpPort });
  });

  afterAll(async () => {
    await mailer?.close();
    await redisClient?.quit();
    await prisma?.$disconnect();
    await Promise.allSettled([
      pgContainer?.stop(),
      redisContainer?.stop(),
      mailpitContainer?.stop(),
    ]);
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE notifications, outbox_events, appointments, doctors, users RESTART IDENTITY CASCADE;
    `);
    await redisClient.flushall();
    await fetch(`${mailpitApiUrl}/messages`, { method: 'DELETE' });
  });

  async function seedAppointment(slotOffsetHours = 48) {
    const patient = await prisma.user.create({
      data: {
        email: `patient-${randomUUID().slice(0, 8)}@medibook.test`,
        passwordHash: 'hash',
        name: 'Anita Roy',
        role: 'PATIENT',
      },
    });
    const docUser = await prisma.user.create({
      data: {
        email: `doc-${randomUUID().slice(0, 8)}@medibook.test`,
        passwordHash: 'hash',
        name: 'Dr. Subhash Chandra',
        role: 'DOCTOR',
      },
    });
    const doctor = await prisma.doctor.create({
      data: {
        userId: docUser.id,
        specialty: 'Cardiology',
        consultationFeePaise: 80000,
        isVerified: true,
        verificationStatus: 'APPROVED',
      },
    });
    const slotTime = new Date(Date.now() + slotOffsetHours * 60 * 60 * 1000);
    const appt = await prisma.appointment.create({
      data: {
        bookingRef: `MB-20261128-${Math.floor(Math.random() * 900 + 100)}`,
        patientId: patient.id,
        doctorId: doctor.id,
        slotTime,
        consultationMode: 'VIDEO',
        status: 'CONFIRMED',
      },
    });
    return { patient, doctor, appt };
  }

  it('Outbox relay -> BullMQ (jobId=eventId) -> in-app Notification + Mailpit email + 24h/1h reminders + cancel cleanup', async () => {
    const { patient, appt } = await seedAppointment(48);
    const engine = new WorkerEngine({
      prisma,
      redisUrl,
      mailer,
      logger,
      backoffDelayMs: 100,
    });

    try {
      const outbox = await prisma.outboxEvent.create({
        data: {
          aggregateType: 'APPOINTMENT',
          aggregateId: appt.id,
          eventType: 'APPOINTMENT_CONFIRMED',
          payload: { appointmentId: appt.id },
        },
      });

      const published = await engine.pollOutboxOnce();
      expect(published).toBe(1);

      // Verify in-app notification row & Mailpit email & delayed reminders
      await waitUntil(async () => {
        const notifs = await prisma.notification.findMany({ where: { userId: patient.id } });
        return notifs.length >= 1;
      });

      const notifs = await prisma.notification.findMany({ where: { userId: patient.id } });
      expect(notifs[0].type).toBe('APPOINTMENT_CONFIRMED');

      // Check Mailpit received the email
      const mpRes = await fetch(`${mailpitApiUrl}/messages`);
      const mpData = (await mpRes.json()) as { total: number; messages: Array<{ Subject: string; To: Array<{ Address: string }> }> };
      expect(mpData.total).toBeGreaterThanOrEqual(1);
      expect(mpData.messages[0].To[0].Address).toBe(patient.email);

      // Check 24h and 1h delayed jobs exist
      const rem24 = await engine.reminderQueue.getJob(`reminder-24h-${appt.id}`);
      const rem1 = await engine.reminderQueue.getJob(`reminder-1h-${appt.id}`);
      expect(rem24).toBeTruthy();
      expect(rem1).toBeTruthy();

      // Verify outbox event marked PROCESSED
      const processedOutbox = await prisma.outboxEvent.findUnique({ where: { id: outbox.id } });
      expect(processedOutbox?.status).toBe('PROCESSED');

      // Now cancel appointment -> reminders must be cancelled!
      await prisma.appointment.update({
        where: { id: appt.id },
        data: { status: 'CANCELLED', cancellationReason: 'Patient cancelled' },
      });
      await prisma.outboxEvent.create({
        data: {
          aggregateType: 'APPOINTMENT',
          aggregateId: appt.id,
          eventType: 'AppointmentCancelled',
          payload: { appointmentId: appt.id, reason: 'Patient cancelled' },
        },
      });

      await engine.pollOutboxOnce();

      await waitUntil(async () => {
        const j24 = await engine.reminderQueue.getJob(`reminder-24h-${appt.id}`);
        const j1 = await engine.reminderQueue.getJob(`reminder-1h-${appt.id}`);
        return j24 === undefined && j1 === undefined;
      });
    } finally {
      await engine.close();
    }
  });

  it('Worker crash mid-job -> stalled lock recovered and retried by surviving worker', async () => {
    const { patient, appt } = await seedAppointment(48);

    await prisma.outboxEvent.create({
      data: {
        aggregateType: 'APPOINTMENT',
        aggregateId: appt.id,
        eventType: 'APPOINTMENT_CONFIRMED',
        payload: { appointmentId: appt.id },
      },
    });

    let crashedOnce = false;
    const crashingWorker = new WorkerEngine({
      prisma,
      redisUrl,
      mailer,
      logger,
      lockDurationMs: 1000,
      stalledIntervalMs: 250,
      onJobStart: async () => {
        if (!crashedOnce) {
          crashedOnce = true;
          // Force-drop Redis connection mid-job to simulate sudden SIGKILL worker crash
          crashingWorker.workerConnection.disconnect();
          // Hang longer than lockDuration so job stalls without completing
          await new Promise((r) => setTimeout(r, 3000));
        }
      },
    });

    await crashingWorker.pollOutboxOnce();
    await waitUntil(async () => crashedOnce, 5000, 50);

    // Boot surviving worker with short stalledInterval to recover stalled job
    const survivingWorker = new WorkerEngine({
      prisma,
      redisUrl,
      mailer,
      logger,
      lockDurationMs: 1000,
      stalledIntervalMs: 250,
    });

    try {
      await waitUntil(async () => {
        const count = await prisma.notification.count({ where: { userId: patient.id } });
        return count >= 1;
      }, 20000, 200);

      const notifs = await prisma.notification.findMany({ where: { userId: patient.id } });
      expect(notifs).toHaveLength(1);
      expect(notifs[0].type).toBe('APPOINTMENT_CONFIRMED');
    } finally {
      await crashingWorker.close(true);
      await survivingWorker.close();
    }
  });

  it('Redis down between DB commit and publish -> outbox stays PENDING and delivers once Redis recovers', async () => {
    const { patient, appt } = await seedAppointment(48);

    const outbox = await prisma.outboxEvent.create({
      data: {
        aggregateType: 'APPOINTMENT',
        aggregateId: appt.id,
        eventType: 'APPOINTMENT_CONFIRMED',
        payload: { appointmentId: appt.id },
      },
    });

    // Simulate Redis outage (unreachable Redis client with fail-fast)
    const downRedis = new Redis('redis://127.0.0.1:59999', {
      maxRetriesPerRequest: 0,
      enableOfflineQueue: false,
      retryStrategy: () => null,
      lazyConnect: true,
    });
    const downQueue = new Queue('outbox-queue', { connection: downRedis });

    await expect(
      pollAndPublishOutbox(prisma, downQueue, logger, { batchSize: 10 }),
    ).rejects.toThrow();

    await downQueue.close();
    downRedis.disconnect();

    // Event MUST still be PENDING in Postgres
    const stillPending = await prisma.outboxEvent.findUnique({ where: { id: outbox.id } });
    expect(stillPending?.status).toBe('PENDING');

    // Now Redis recovers -> WorkerEngine polls and delivers
    const engine = new WorkerEngine({
      prisma,
      redisUrl,
      mailer,
      logger,
    });

    try {
      const published = await engine.pollOutboxOnce();
      expect(published).toBe(1);

      await waitUntil(async () => {
        const count = await prisma.notification.count({ where: { userId: patient.id } });
        return count >= 1;
      });
    } finally {
      await engine.close();
    }
  });

  it('Poison job retries with exponential backoff and routes to DLQ after max attempts', async () => {
    const outbox = await prisma.outboxEvent.create({
      data: {
        aggregateType: 'TEST',
        aggregateId: randomUUID(),
        eventType: 'POISON_JOB',
        payload: { poison: true },
      },
    });

    const engine = new WorkerEngine({
      prisma,
      redisUrl,
      mailer,
      logger,
      maxAttempts: 3,
      backoffDelayMs: 100,
    });

    try {
      await engine.pollOutboxOnce();

      await waitUntil(async () => {
        const row = await prisma.outboxEvent.findUnique({ where: { id: outbox.id } });
        return row?.status === 'DLQ';
      }, 15000, 150);

      const dlqJob = await engine.dlqQueue.getJob(`dlq-outbox-queue-${outbox.id}`);
      expect(dlqJob).toBeTruthy();
      expect(dlqJob?.data.originalJobId).toBe(outbox.id);
      expect(dlqJob?.data.failedReason).toContain('Simulated poison job failure');
    } finally {
      await engine.close();
    }
  });
});
