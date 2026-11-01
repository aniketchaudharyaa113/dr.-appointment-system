import Redis from "ioredis";
import pool from "../db/pool";
import { getIO } from "../sockets/slotEvents";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const QUEUE_KEY = "medibook:jobs:queue";

export interface QueueJob<T = any> {
  id: string;
  type: "NOTIFICATION" | "AUDIT" | "EMAIL_DISPATCH";
  payload: T;
  createdAt: number;
}

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

// In-memory queue fallback
const inMemoryQueue: QueueJob[] = [];
let isProcessing = false;
let redisProducer: Redis | null = null;
let redisConsumer: Redis | null = null;
let isRedisQueueActive = false;

// Initialize Queue
export function initMessageQueue() {
  try {
    redisProducer = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      retryStrategy: () => null,
    });

    redisConsumer = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      retryStrategy: () => null,
    });

    Promise.all([redisProducer.connect(), redisConsumer.connect()])
      .then(() => {
        isRedisQueueActive = true;
        console.log("[Queue] Redis messaging queue initialized successfully.");
        startRedisWorker();
      })
      .catch(() => {
        isRedisQueueActive = false;
        console.log("[Queue] Redis queue unavailable, running resilient in-memory worker.");
        startMemoryWorker();
      });
  } catch {
    isRedisQueueActive = false;
    startMemoryWorker();
  }
}

// Enqueue a job
export async function enqueueJob<T>(type: QueueJob["type"], payload: T): Promise<string> {
  const job: QueueJob<T> = {
    id: `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    payload,
    createdAt: Date.now(),
  };

  if (isRedisQueueActive && redisProducer) {
    try {
      await redisProducer.rpush(QUEUE_KEY, JSON.stringify(job));
      return job.id;
    } catch {
      // Fall back to memory queue on write failure
    }
  }

  inMemoryQueue.push(job);
  processMemoryQueue();
  return job.id;
}

// Process single job
async function processJob(job: QueueJob): Promise<void> {
  try {
    switch (job.type) {
      case "NOTIFICATION": {
        const p = job.payload as NotificationPayload;
        const res = await pool.query(
          `INSERT INTO notifications (user_id, type, title, message, link)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`,
          [p.userId, p.type, p.title, p.message, p.link || null]
        );
        // If socket server is initialized, push real-time notification to user's isolated room
        try {
          const io = getIO();
          io.to(`user:${p.userId}`).emit("notification", res.rows[0]);
          io.to(`user:${p.userId}`).emit(`notification:${p.userId}`, res.rows[0]);
        } catch {}
        break;
      }
      case "AUDIT": {
        const a = job.payload as AuditPayload;
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
        break;
      }
      case "EMAIL_DISPATCH": {
        // Transactional email / SMS log stub
        const e = job.payload;
        console.log(`[Queue:EmailDispatcher] Dispatched ${e.subject || "Alert"} to ${e.recipient}`);
        break;
      }
    }
  } catch (err) {
    console.error(`[Queue] Failed to process job ${job.id} (${job.type}):`, err);
  }
}

// Redis worker loop
async function startRedisWorker() {
  if (!redisConsumer) return;
  while (isRedisQueueActive) {
    try {
      const res = await redisConsumer.blpop(QUEUE_KEY, 2);
      if (res && res[1]) {
        const job = JSON.parse(res[1]) as QueueJob;
        await processJob(job);
      }
    } catch (err) {
      // Pause briefly on disconnect
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

// In-memory worker loop
function startMemoryWorker() {
  setInterval(processMemoryQueue, 500);
}

async function processMemoryQueue() {
  if (isProcessing || inMemoryQueue.length === 0) return;
  isProcessing = true;
  while (inMemoryQueue.length > 0) {
    const job = inMemoryQueue.shift();
    if (job) {
      await processJob(job);
    }
  }
  isProcessing = false;
}
