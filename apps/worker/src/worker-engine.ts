import { PrismaClient } from '@prisma/client';
import { Queue, Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import type { Logger } from 'pino';
import * as crypto from 'crypto';
import type { Mailer } from './mailer.js';
import { pollAndPublishOutbox } from './outbox-relay.js';

export interface WorkerEngineOptions {
  prisma: PrismaClient;
  redisUrl: string;
  mailer: Mailer;
  logger: Logger;
  maxAttempts?: number;
  backoffDelayMs?: number;
  lockDurationMs?: number;
  stalledIntervalMs?: number;
  concurrency?: number;
  onJobStart?: (job: Job) => Promise<void> | void;
}

export class WorkerEngine {
  public readonly queueConnection: Redis;
  public readonly workerConnection: Redis;
  public readonly outboxQueue: Queue;
  public readonly reminderQueue: Queue;
  public readonly dlqQueue: Queue;
  public readonly expiryQueue: Queue;
  public readonly outboxWorker: Worker;
  public readonly reminderWorker: Worker;
  public readonly expiryWorker: Worker;

  private readonly prisma: PrismaClient;
  private readonly mailer: Mailer;
  private readonly logger: Logger;
  private readonly maxAttempts: number;
  private readonly backoffDelayMs: number;

  constructor(private readonly opts: WorkerEngineOptions) {
    this.prisma = opts.prisma;
    this.mailer = opts.mailer;
    this.logger = opts.logger;
    this.maxAttempts = opts.maxAttempts ?? 3;
    this.backoffDelayMs = opts.backoffDelayMs ?? 500;

    this.queueConnection = new Redis(opts.redisUrl, {
      maxRetriesPerRequest: null,
    });
    this.workerConnection = new Redis(opts.redisUrl, {
      maxRetriesPerRequest: null,
    });

    this.outboxQueue = new Queue('outbox-queue', {
      connection: this.queueConnection,
    });
    this.reminderQueue = new Queue('reminders', {
      connection: this.queueConnection,
    });
    this.dlqQueue = new Queue('dlq-queue', {
      connection: this.queueConnection,
    });
    this.expiryQueue = new Queue('expiry-queue', {
      connection: this.queueConnection,
    });

    const workerOpts = {
      connection: this.workerConnection,
      concurrency: opts.concurrency ?? 5,
      lockDuration: opts.lockDurationMs ?? 30000,
      stalledInterval: opts.stalledIntervalMs ?? 5000,
    };

    this.outboxWorker = new Worker(
      'outbox-queue',
      async (job) => {
        if (this.opts.onJobStart) {
          await this.opts.onJobStart(job);
        }
        return this.processOutboxJob(job);
      },
      workerOpts,
    );

    this.reminderWorker = new Worker(
      'reminders',
      async (job) => this.processReminderJob(job),
      workerOpts,
    );

    this.expiryWorker = new Worker(
      'expiry-queue',
      async (job) => this.processExpiryJob(job),
      workerOpts,
    );

    this.attachDlqHandler(this.outboxWorker, 'outbox-queue');
    this.attachDlqHandler(this.reminderWorker, 'reminders');
  }

  private attachDlqHandler(worker: Worker, queueName: string) {
    worker.on('failed', async (job, err) => {
      if (!job) return;
      const configuredAttempts = job.opts.attempts ?? this.maxAttempts;
      this.logger.warn(
        {
          queue: queueName,
          jobId: job.id,
          name: job.name,
          attemptsMade: job.attemptsMade,
          configuredAttempts,
          error: err.message,
        },
        'Job failed',
      );

      if (job.attemptsMade >= configuredAttempts) {
        await this.dlqQueue.add(
          'dlq-entry',
          {
            originalQueue: queueName,
            originalJobId: job.id,
            eventType: job.name,
            data: job.data,
            failedReason: err.message,
            failedAt: new Date().toISOString(),
          },
          {
            jobId: `dlq-${queueName}-${job.id}`,
            removeOnComplete: false,
          },
        );

        const outboxId = (job.data as any)?.outboxEventId;
        if (outboxId) {
          await this.prisma.$executeRaw`
            UPDATE outbox_events
            SET status = 'DLQ', processed_at = NOW()
            WHERE id = ${outboxId}::uuid
          `;
        }

        this.logger.error(
          { queue: queueName, jobId: job.id, err: err.message },
          'Moved exhausted poison job to DLQ',
        );
      }
    });
  }

  async pollOutboxOnce(batchSize = 50): Promise<number> {
    return pollAndPublishOutbox(this.prisma, this.outboxQueue, this.logger, {
      batchSize,
      maxAttempts: this.maxAttempts,
      backoffDelayMs: this.backoffDelayMs,
    });
  }

  private async processOutboxJob(job: Job) {
    const data = job.data as {
      outboxEventId?: string;
      aggregateId: string;
      eventType: string;
      payload: Record<string, any>;
    };
    const eventType = data.eventType || job.name;
    const payload = data.payload || {};

    this.logger.info({ jobId: job.id, eventType }, 'Processing outbox event');

    if (eventType === 'POISON_JOB' || payload.poison === true) {
      throw new Error(`Simulated poison job failure for ${job.id}`);
    }

    switch (eventType) {
      case 'APPOINTMENT_CONFIRMED':
      case 'AppointmentConfirmed': {
        await this.handleAppointmentConfirmed(payload.appointmentId || data.aggregateId);
        break;
      }

      case 'AppointmentCancelled':
      case 'AppointmentCancelledByDoctor':
      case 'APPOINTMENT_EXPIRED':
      case 'AppointmentRescheduled': {
        await this.handleAppointmentCancelledOrExpired(
          payload.appointmentId || data.aggregateId,
          eventType,
          payload.reason,
        );
        break;
      }

      case 'PAYMENT_REFUND_REQUESTED': {
        await this.handleRefundDispatch(payload.refundId);
        break;
      }

      case 'PAYMENT_REFUNDED':
      case 'PAYMENT_AUTO_REFUNDED': {
        await this.handlePaymentRefundedNotification(payload);
        break;
      }

      case 'WaitlistSlotOffered': {
        await this.handleWaitlistOffered(payload);
        break;
      }

      case 'APPOINTMENT_PENDING_PAYMENT':
      case 'PAYMENT_CAPTURED': {
        // Recorded in outbox for audit/downstream subscribers; confirmation notification handled on APPOINTMENT_CONFIRMED
        break;
      }

      default:
        this.logger.info({ eventType }, 'No-op for informational outbox event');
    }

    if (data.outboxEventId) {
      await this.prisma.$executeRaw`
        UPDATE outbox_events
        SET status = 'PROCESSED', processed_at = NOW()
        WHERE id = ${data.outboxEventId}::uuid
      `;
    }

    return { processed: true, eventType };
  }

  private async handleAppointmentConfirmed(appointmentId: string) {
    const appt = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        patient: true,
        doctor: { include: { user: true } },
      },
    });
    if (!appt) return;

    const istTime = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(appt.slotTime);

    const title = `Appointment Confirmed (${appt.bookingRef || appt.id.slice(0, 8)})`;
    const body = `Your ${appt.consultationMode} consultation with ${appt.doctor.user.name} (${appt.doctor.specialty}) is confirmed for ${istTime} IST.`;

    // 1. In-app notification row for patient
    await this.prisma.notification.create({
      data: {
        userId: appt.patientId,
        type: 'APPOINTMENT_CONFIRMED',
        title,
        body,
        metadata: {
          appointmentId: appt.id,
          bookingRef: appt.bookingRef,
          slotTime: appt.slotTime.toISOString(),
        },
      },
    });

    // 2. Real email via Nodemailer -> Mailpit
    await this.mailer.sendMail({
      to: appt.patient.email,
      subject: `MediBook: ${title}`,
      text: `${body}\n\nBooking Reference: ${appt.bookingRef}\nManage your appointment in MediBook.`,
      html: `<p>${body}</p><p><strong>Booking Reference:</strong> ${appt.bookingRef}</p>`,
    });

    // 3. Schedule 24h and 1h delayed reminder jobs in BullMQ
    const nowMs = Date.now();
    const slotMs = appt.slotTime.getTime();
    const delay24h = slotMs - 24 * 60 * 60 * 1000 - nowMs;
    const delay1h = slotMs - 1 * 60 * 60 * 1000 - nowMs;

    if (delay24h > 0) {
      await this.reminderQueue.add(
        'REMINDER_24H',
        { appointmentId: appt.id, kind: 'REMINDER_24H' },
        {
          jobId: `reminder-24h-${appt.id}`,
          delay: delay24h,
          attempts: 3,
          backoff: { type: 'exponential', delay: this.backoffDelayMs },
          removeOnComplete: true,
        },
      );
    }

    if (delay1h > 0) {
      await this.reminderQueue.add(
        'REMINDER_1H',
        { appointmentId: appt.id, kind: 'REMINDER_1H' },
        {
          jobId: `reminder-1h-${appt.id}`,
          delay: delay1h,
          attempts: 3,
          backoff: { type: 'exponential', delay: this.backoffDelayMs },
          removeOnComplete: true,
        },
      );
    }
  }

  private async handleAppointmentCancelledOrExpired(
    appointmentId: string,
    eventType: string,
    reason?: string,
  ) {
    // 1. Cancel any pending 24h & 1h reminder jobs
    for (const prefix of ['reminder-24h', 'reminder-1h']) {
      const job = await this.reminderQueue.getJob(`${prefix}-${appointmentId}`);
      if (job) {
        try {
          await job.remove();
          this.logger.info({ jobId: job.id }, 'Cancelled scheduled reminder job');
        } catch (err: any) {
          this.logger.warn({ jobId: job.id, err: err.message }, 'Could not remove reminder job');
        }
      }
    }

    const appt = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        patient: true,
        doctor: { include: { user: true } },
      },
    });
    if (!appt) return;

    const isExpired = eventType === 'APPOINTMENT_EXPIRED';
    const title = isExpired
      ? `Appointment Payment Window Expired (${appt.bookingRef || appt.id.slice(0, 8)})`
      : `Appointment Cancelled (${appt.bookingRef || appt.id.slice(0, 8)})`;
    const body = isExpired
      ? `Your unpaid reservation with ${appt.doctor.user.name} expired and the slot was released.`
      : `Your appointment with ${appt.doctor.user.name} was cancelled. Reason: ${reason || appt.cancellationReason || 'Cancelled'}.`;

    await this.prisma.notification.create({
      data: {
        userId: appt.patientId,
        type: eventType,
        title,
        body,
        metadata: { appointmentId: appt.id, bookingRef: appt.bookingRef },
      },
    });

    await this.mailer.sendMail({
      to: appt.patient.email,
      subject: `MediBook: ${title}`,
      text: body,
    });
  }

  private async handleRefundDispatch(refundId?: string) {
    if (!refundId) return;
    const refund = await this.prisma.refund.findUnique({
      where: { id: refundId },
      include: { payment: true },
    });
    if (!refund) return;
    if (refund.status === 'PROCESSED' && refund.providerRefundId) {
      return;
    }

    const providerRefundId = `rfnd_worker_${crypto.randomUUID().slice(0, 12)}`;
    await this.prisma.refund.update({
      where: { id: refund.id },
      data: {
        providerRefundId,
        status: 'PROCESSED',
      },
    });
  }

  private async handlePaymentRefundedNotification(payload: Record<string, any>) {
    const appointmentId = payload.appointmentId;
    if (!appointmentId) return;
    const appt = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: { patient: true },
    });
    if (!appt) return;

    const amountInr = ((payload.amountPaise || 0) / 100).toFixed(2);
    const title = `Refund Initiated (₹${amountInr})`;
    const body = `A refund of ₹${amountInr} has been processed for booking ${appt.bookingRef || appt.id}. Reason: ${payload.reason || 'Refunded'}.`;

    await this.prisma.notification.create({
      data: {
        userId: appt.patientId,
        type: 'PAYMENT_REFUNDED',
        title,
        body,
        metadata: payload,
      },
    });

    await this.mailer.sendMail({
      to: appt.patient.email,
      subject: `MediBook: ${title}`,
      text: body,
    });
  }

  private async handleWaitlistOffered(payload: Record<string, any>) {
    if (!payload.patientId) return;
    const patient = await this.prisma.user.findUnique({
      where: { id: payload.patientId },
    });
    if (!patient) return;

    const title = 'Waitlist Slot Available — Claim Within 15 Minutes';
    const body = `A slot at ${payload.slotTime} has opened up. Claim your slot before ${payload.claimExpiresAt}.`;

    await this.prisma.notification.create({
      data: {
        userId: patient.id,
        type: 'WAITLIST_OFFERED',
        title,
        body,
        metadata: payload,
      },
    });

    await this.mailer.sendMail({
      to: patient.email,
      subject: `MediBook: ${title}`,
      text: body,
    });
  }

  private async processReminderJob(job: Job) {
    const { appointmentId, kind } = job.data as {
      appointmentId: string;
      kind: 'REMINDER_24H' | 'REMINDER_1H';
    };

    const appt = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        patient: true,
        doctor: { include: { user: true } },
      },
    });

    if (!appt || appt.status !== 'CONFIRMED') {
      return { skipped: true, reason: 'Appointment no longer confirmed' };
    }

    const label = kind === 'REMINDER_24H' ? '24 Hours' : '1 Hour';
    const title = `Upcoming Consultation in ${label} (${appt.bookingRef})`;
    const body = `Reminder: Your consultation with ${appt.doctor.user.name} starts in ${label}.`;

    await this.prisma.notification.create({
      data: {
        userId: appt.patientId,
        type: kind,
        title,
        body,
        metadata: { appointmentId: appt.id },
      },
    });

    await this.mailer.sendMail({
      to: appt.patient.email,
      subject: `MediBook Reminder: ${title}`,
      text: body,
    });

    return { sent: true, kind };
  }

  private async processExpiryJob(job: Job) {
    const expiryMinutes = (job.data as any)?.expiryMinutes ?? 15;
    const cutoff = new Date(Date.now() - expiryMinutes * 60 * 1000);

    const released = await this.prisma.$transaction(async (tx) => {
      const candidates = await tx.$queryRaw<
        Array<{ id: string; doctor_id: string; patient_id: string; slot_time: Date }>
      >`
        SELECT a.id, a.doctor_id, a.patient_id, a.slot_time
        FROM appointments a
        LEFT JOIN payments p ON p.appointment_id = a.id
        WHERE a.status = 'PENDING_PAYMENT'
          AND a.created_at < ${cutoff}
          AND (p.id IS NULL OR p.status <> 'CAPTURED')
        FOR UPDATE OF a SKIP LOCKED
      `;

      for (const appt of candidates) {
        await tx.appointment.update({
          where: { id: appt.id },
          data: {
            status: 'CANCELLED',
            cancellationReason: 'Payment window expired',
          },
        });
        await tx.payment.updateMany({
          where: {
            appointmentId: appt.id,
            status: { in: ['INITIATED', 'PENDING'] },
          },
          data: { status: 'FAILED' },
        });
        await tx.outboxEvent.create({
          data: {
            aggregateType: 'APPOINTMENT',
            aggregateId: appt.id,
            eventType: 'APPOINTMENT_EXPIRED',
            payload: {
              appointmentId: appt.id,
              doctorId: appt.doctor_id,
              patientId: appt.patient_id,
              slotTime: new Date(appt.slot_time).toISOString(),
            },
          },
        });
      }

      return candidates.length;
    });

    return { released };
  }

  async scheduleExpiryCheck() {
    await this.expiryQueue.add(
      'expire-unpaid-bookings',
      { expiryMinutes: 15 },
      {
        repeat: { every: 60000 },
        jobId: 'repeat-expire-unpaid-bookings',
      },
    );
  }

  async close(force = false) {
    await Promise.allSettled([
      this.outboxWorker.close(force),
      this.reminderWorker.close(force),
      this.expiryWorker.close(force),
    ]);
    await Promise.allSettled([
      this.outboxQueue.close(),
      this.reminderQueue.close(),
      this.dlqQueue.close(),
      this.expiryQueue.close(),
    ]);
    if (force) {
      this.workerConnection.disconnect();
      this.queueConnection.disconnect();
    } else {
      await Promise.allSettled([
        this.workerConnection.quit(),
        this.queueConnection.quit(),
      ]);
    }
  }
}
