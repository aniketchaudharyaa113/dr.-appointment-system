import { Queue, JobsOptions } from "bullmq";
import Redis from "ioredis";

export const QUEUE_NAMES = {
  NOTIFICATIONS: "notifications",
  AUDIT: "audit",
  EMAIL: "email",
  REMINDERS: "reminders",
} as const;

export interface NotificationPayload {
  userId: string;
  type: string;
  title: string;
  message: string;
  link?: string;
}

export interface AuditPayload {
  actorId?: string | null;
  actorRole: string;
  action: string;
  targetId?: string;
  details?: Record<string, any>;
}

export interface EmailPayload {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  template?: "booking_confirmation" | "cancellation" | "reminder" | "prescription_ready";
  templateData?: Record<string, any>;
  recipient?: string; // backward compat with stub
}

export interface ReminderPayload {
  appointmentId: string;
  patientId: string;
  doctorId: string;
  slotTime: string;
  reminderType: "24h" | "1h";
}

export const defaultJobOptions: JobsOptions = {
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: 1000,
  },
  removeOnComplete: {
    count: 1000,
  },
  removeOnFail: {
    count: 5000,
  },
};

export function createRedisConnection(customUrl?: string): Redis {
  const url = customUrl || process.env.REDIS_URL || "redis://localhost:6379";
  return new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy(times) {
      if (times > 10) return null;
      return Math.min(times * 100, 2000);
    },
  });
}

let sharedRedisConn: Redis | null = null;
let notificationsQueue: Queue<NotificationPayload> | null = null;
let auditQueue: Queue<AuditPayload> | null = null;
let emailQueue: Queue<EmailPayload> | null = null;
let remindersQueue: Queue<ReminderPayload> | null = null;

export function getQueues() {
  if (!sharedRedisConn) {
    sharedRedisConn = createRedisConnection();
    notificationsQueue = new Queue<NotificationPayload>(QUEUE_NAMES.NOTIFICATIONS, {
      connection: sharedRedisConn,
      defaultJobOptions,
    });
    auditQueue = new Queue<AuditPayload>(QUEUE_NAMES.AUDIT, {
      connection: sharedRedisConn,
      defaultJobOptions,
    });
    emailQueue = new Queue<EmailPayload>(QUEUE_NAMES.EMAIL, {
      connection: sharedRedisConn,
      defaultJobOptions,
    });
    remindersQueue = new Queue<ReminderPayload>(QUEUE_NAMES.REMINDERS, {
      connection: sharedRedisConn,
      defaultJobOptions,
    });
  }
  return {
    notificationsQueue: notificationsQueue!,
    auditQueue: auditQueue!,
    emailQueue: emailQueue!,
    remindersQueue: remindersQueue!,
  };
}

export function getAllQueues(): Queue[] {
  const q = getQueues();
  return [q.notificationsQueue, q.auditQueue, q.emailQueue, q.remindersQueue];
}

export function initMessageQueue() {
  getQueues();
  console.log("[BullMQ] Queues initialized: notifications, audit, email, reminders.");
}

export async function closeMessageQueue(): Promise<void> {
  if (notificationsQueue) await notificationsQueue.close();
  if (auditQueue) await auditQueue.close();
  if (emailQueue) await emailQueue.close();
  if (remindersQueue) await remindersQueue.close();
  if (sharedRedisConn) {
    await sharedRedisConn.quit();
    sharedRedisConn = null;
  }
  notificationsQueue = null;
  auditQueue = null;
  emailQueue = null;
  remindersQueue = null;
}

export async function enqueueJob<T = any>(
  type: "NOTIFICATION" | "AUDIT" | "EMAIL_DISPATCH" | "REMINDER",
  payload: T,
  options?: JobsOptions
): Promise<string> {
  const queues = getQueues();
  let job;

  switch (type) {
    case "NOTIFICATION":
      job = await queues.notificationsQueue.add(
        "notification",
        payload as unknown as NotificationPayload,
        options
      );
      break;
    case "AUDIT":
      job = await queues.auditQueue.add("audit", payload as unknown as AuditPayload, options);
      break;
    case "EMAIL_DISPATCH":
      job = await queues.emailQueue.add("email", payload as unknown as EmailPayload, options);
      break;
    case "REMINDER":
      job = await queues.remindersQueue.add("reminder", payload as unknown as ReminderPayload, options);
      break;
    default:
      throw new Error(`Unsupported queue job type: ${type}`);
  }

  return job.id ? String(job.id) : `job_${Date.now()}`;
}
