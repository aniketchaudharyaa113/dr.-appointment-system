import client from "prom-client";
import { Request, Response, NextFunction } from "express";
import { getAllQueues } from "../queue/messageQueue";

export const register = new client.Registry();

client.collectDefaultMetrics({
  register,
  prefix: "medibook_",
});

export const httpRequestDurationSeconds = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

export const bookingCounter = new client.Counter({
  name: "medibook_booking_total",
  help: "Total booking attempts partitioned by outcome",
  labelNames: ["status"],
  registers: [register],
});

export const cacheHitsCounter = new client.Counter({
  name: "medibook_cache_hits_total",
  help: "Total cache hits",
  registers: [register],
});

export const cacheMissesCounter = new client.Counter({
  name: "medibook_cache_misses_total",
  help: "Total cache misses",
  registers: [register],
});

export const activeSocketConnections = new client.Gauge({
  name: "medibook_socket_connections_active",
  help: "Number of active Socket.IO connections",
  registers: [register],
});

export const queueDepthGauge = new client.Gauge({
  name: "medibook_queue_depth",
  help: "Number of waiting and active jobs in BullMQ queues",
  labelNames: ["queue"],
  registers: [register],
});

export const queueFailedJobsGauge = new client.Gauge({
  name: "medibook_queue_failed_jobs",
  help: "Number of permanently failed jobs in BullMQ queues",
  labelNames: ["queue"],
  registers: [register],
});

export function metricsMiddleware(req: Request, res: Response, next: NextFunction) {
  if (req.path === "/metrics" || req.path.startsWith("/health")) {
    return next();
  }
  const start = process.hrtime();
  res.on("finish", () => {
    const [seconds, nanoseconds] = process.hrtime(start);
    const duration = seconds + nanoseconds / 1e9;
    const route = req.route ? (req.baseUrl || "") + req.route.path : req.path;
    httpRequestDurationSeconds.observe(
      {
        method: req.method,
        route: route || req.path,
        status_code: res.statusCode,
      },
      duration
    );
  });
  next();
}

export async function updateQueueMetrics() {
  try {
    const queues = getAllQueues();
    for (const q of queues) {
      const counts = await q.getJobCounts("waiting", "active", "failed", "delayed");
      queueDepthGauge.set({ queue: q.name }, (counts.waiting || 0) + (counts.active || 0));
      queueFailedJobsGauge.set({ queue: q.name }, counts.failed || 0);
    }
  } catch {}
}
