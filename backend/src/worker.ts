import dotenv from "dotenv";
dotenv.config();

import { Worker, Job } from "bullmq";
import pool from "./db/pool";
import {
  QUEUE_NAMES,
  createRedisConnection,
  NotificationPayload,
  AuditPayload,
  EmailPayload,
  ReminderPayload,
} from "./queue/messageQueue";
import { sendEmail } from "./services/emailService";
import { getRedisEmitter } from "./sockets/slotEvents";
import { startOutboxRelay, stopOutboxRelay } from "./queue/outboxRelay";

console.log("[Worker] Initializing MediBook background queue workers and outbox relay...");

// Start polling transactional outbox
startOutboxRelay(1000);

const workers: Worker[] = [];

// 1. Notifications Worker
const notificationsWorker = new Worker<NotificationPayload>(
  QUEUE_NAMES.NOTIFICATIONS,
  async (job: Job<NotificationPayload>) => {
    const p = job.data;
    const res = await pool.query(
      `INSERT INTO notifications (user_id, type, title, message, link)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [p.userId, p.type, p.title, p.message, p.link || null]
    );

    try {
      const emitter = getRedisEmitter();
      emitter.to(`user:${p.userId}`).emit("notification", res.rows[0]);
      emitter.to(`user:${p.userId}`).emit(`notification:${p.userId}`, res.rows[0]);
    } catch (err: any) {
      console.warn("[Worker] Failed to broadcast notification via Redis emitter:", err?.message || err);
    }

    return { processed: true, notificationId: res.rows[0]?.id };
  },
  {
    connection: createRedisConnection(),
    concurrency: 10,
  }
);
workers.push(notificationsWorker);

// 2. Audit Logs Worker
const auditWorker = new Worker<AuditPayload>(
  QUEUE_NAMES.AUDIT,
  async (job: Job<AuditPayload>) => {
    const a = job.data;
    await pool.query(
      `INSERT INTO audit_logs (actor_id, actor_role, action, target_id, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        a.actorId || null,
        a.actorRole,
        a.action,
        a.targetId || null,
        a.details ? JSON.stringify(a.details) : null,
      ]
    );
    return { processed: true };
  },
  {
    connection: createRedisConnection(),
    concurrency: 10,
  }
);
workers.push(auditWorker);

// 3. Email Dispatch Worker
const emailWorker = new Worker<EmailPayload>(
  QUEUE_NAMES.EMAIL,
  async (job: Job<EmailPayload>) => {
    const email = job.data;
    const to = email.to || email.recipient;
    if (!to) {
      throw new Error(`Email recipient is missing for job ${job.id}`);
    }

    await sendEmail({
      to,
      subject: email.subject,
      text: email.text,
      html: email.html,
      template: email.template,
      templateData: email.templateData,
    });

    console.log(`[Worker:Email] Email dispatched to ${to} (${email.subject})`);
    return { sent: true, to };
  },
  {
    connection: createRedisConnection(),
    concurrency: 5,
  }
);
workers.push(emailWorker);

// 4. Reminders Worker
const remindersWorker = new Worker<ReminderPayload>(
  QUEUE_NAMES.REMINDERS,
  async (job: Job<ReminderPayload>) => {
    const reminder = job.data;
    const aptRes = await pool.query(
      `SELECT a.id, a.slot_time, a.status, a.patient_id,
              u_pat.name AS patient_name, u_pat.email AS patient_email,
              u_doc.name AS doctor_name, d.specialty, d.clinic_address
       FROM appointments a
       JOIN users u_pat ON a.patient_id = u_pat.id
       JOIN doctors d ON a.doctor_id = d.id
       JOIN users u_doc ON d.user_id = u_doc.id
       WHERE a.id = $1 AND a.status IN ('CONFIRMED', 'PENDING')`,
      [reminder.appointmentId]
    );

    if (aptRes.rows.length === 0) {
      console.log(`[Worker:Reminder] Appointment ${reminder.appointmentId} cancelled or completed, skipping reminder.`);
      return { skipped: true };
    }

    const row = aptRes.rows[0];
    const timeLabel = reminder.reminderType === "24h" ? "in 24 hours" : "in 1 hour";

    // 1. Create in-app notification
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, message, link)
       VALUES ($1, 'APPOINTMENT_REMINDER', $2, $3, $4)`,
      [
        row.patient_id,
        `Upcoming Appointment ${timeLabel}`,
        `Your consultation with Dr. ${row.doctor_name} is scheduled for ${row.slot_time}.`,
        `/appointments/${row.id}`,
      ]
    );

    // 2. Send email reminder
    if (row.patient_email) {
      await sendEmail({
        to: row.patient_email,
        subject: `Reminder: Appointment with Dr. ${row.doctor_name} ${timeLabel}`,
        template: "reminder",
        templateData: {
          patientName: row.patient_name,
          doctorName: row.doctor_name,
          slotTime: row.slot_time,
          reminderType: reminder.reminderType,
          clinicAddress: row.clinic_address,
        },
      });
    }

    return { processed: true, appointmentId: reminder.appointmentId };
  },
  {
    connection: createRedisConnection(),
    concurrency: 5,
  }
);
workers.push(remindersWorker);

// DLQ and Error Handling for all workers
workers.forEach((worker) => {
  worker.on("failed", (job, err) => {
    console.error(`[Worker:${worker.name}] Job ${job?.id} failed on attempt ${job?.attemptsMade}:`, err.message);
    const maxAttempts = job?.opts?.attempts || 3;
    if (job && job.attemptsMade >= maxAttempts) {
      console.error(`[Worker:DLQ] Job ${job.id} in queue "${worker.name}" permanently failed and moved to Dead Letter Queue.`);
    }
  });

  worker.on("error", (err) => {
    console.error(`[Worker:${worker.name}] Worker connection error:`, err);
  });
});

console.log("[Worker] All 4 BullMQ workers active and listening for jobs.");

// Graceful shutdown
export async function stopWorkers(): Promise<void> {
  console.log("[Worker] Stopping outbox relay and closing all BullMQ workers...");
  stopOutboxRelay();
  await Promise.all(workers.map((w) => w.close()));
  console.log("[Worker] All workers closed cleanly.");
}

async function handleSignal() {
  await stopWorkers();
  await pool.end();
  process.exit(0);
}

process.on("SIGTERM", handleSignal);
process.on("SIGINT", handleSignal);

export { workers };
