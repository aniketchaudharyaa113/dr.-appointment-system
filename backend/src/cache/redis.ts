import Redis from "ioredis";
import dotenv from "dotenv";
import { logger } from "../lib/logger";

dotenv.config();

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const isDev = process.env.NODE_ENV === "development";

// Metrics counters
let cacheHits = 0;
let cacheMisses = 0;

export function recordCacheHit() {
  cacheHits++;
}

export function recordCacheMiss() {
  cacheMisses++;
}

export function getCacheMetrics() {
  const total = cacheHits + cacheMisses;
  const ratio = total > 0 ? cacheHits / total : 0;
  return {
    hits: cacheHits,
    misses: cacheMisses,
    total,
    hitRatio: parseFloat(ratio.toFixed(4)),
  };
}

export function resetCacheMetrics() {
  cacheHits = 0;
  cacheMisses = 0;
}

// In-memory fallback cache ONLY when NODE_ENV === 'development'
class MemoryCache {
  private store = new Map<string, { value: string; expiry: number | null }>();

  get(key: string): string | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiry && Date.now() > entry.expiry) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key: string, value: string, ttlSeconds?: number): void {
    const expiry = ttlSeconds ? Date.now() + ttlSeconds * 1000 : null;
    this.store.set(key, { value, expiry });
  }

  del(key: string): void {
    this.store.delete(key);
  }

  delPattern(pattern: string): void {
    const prefix = pattern.replace(/\*/g, "");
    for (const k of this.store.keys()) {
      if (k.startsWith(prefix) || k.includes(prefix)) {
        this.store.delete(k);
      }
    }
  }
}

const memoryCache = new MemoryCache();

let redisClient: Redis | null = null;
let redisAvailable = false;

try {
  redisClient = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 1,
    retryStrategy: (times) => {
      if (times > 3) {
        return null;
      }
      return Math.min(times * 100, 1000);
    },
    lazyConnect: true,
  });

  redisClient.on("connect", () => {
    redisAvailable = true;
    logger.info({ redisUrl: REDIS_URL }, "[Cache] Redis connected successfully");
  });

  redisClient.on("error", () => {
    redisAvailable = false;
  });

  redisClient.connect().catch(() => {
    redisAvailable = false;
    if (isDev) {
      logger.info("[Cache] Redis unavailable, using local development in-memory cache.");
    } else {
      logger.info("[Cache] Redis unavailable. Operating in gracefully degraded mode directly against DB.");
    }
  });
} catch {
  redisAvailable = false;
}

export function isRedisConnected(): boolean {
  return redisAvailable;
}

export function setRedisClient(client: Redis | null): void {
  redisClient = client;
  redisAvailable = !!client;
}

export function getRedisClient(): Redis | null {
  return redisClient;
}

// Version-stamped keys helpers
export async function getCacheVersion(scope: string): Promise<number> {
  const versionKey = `medibook:v:${scope}`;
  if (redisAvailable && redisClient) {
    try {
      const v = await redisClient.get(versionKey);
      return v ? parseInt(v, 10) : 1;
    } catch {
      return 1;
    }
  }
  return 1;
}

export async function incrCacheVersion(scope: string): Promise<number> {
  const versionKey = `medibook:v:${scope}`;
  if (redisAvailable && redisClient) {
    try {
      const exists = await redisClient.exists(versionKey);
      if (!exists) {
        await redisClient.set(versionKey, "1");
      }
      const newV = await redisClient.incr(versionKey);
      return newV;
    } catch {
      return 2;
    }
  }
  if (isDev) {
    memoryCache.delPattern(`medibook:${scope}:*`);
  }
  return 2;
}

// Normalize & Whitelist Doctor List Query Keys
export function normalizeDoctorQueryKey(query: Record<string, any>, version: number = 1): string {
  const allowedKeys = [
    "availableToday",
    "city",
    "lat",
    "limit",
    "lng",
    "maxFee",
    "minRating",
    "page",
    "radiusKm",
    "search",
    "sortBy",
    "sortOrder",
    "specialty",
  ];

  const canonical: Record<string, string> = {};

  for (const key of allowedKeys) {
    const val = query[key];
    if (val !== undefined && val !== null && String(val).trim() !== "") {
      if (key === "lat" || key === "lng") {
        const num = parseFloat(String(val));
        if (!isNaN(num)) {
          canonical[key] = (Math.round(num * 100) / 100).toFixed(2);
        }
      } else if (key === "search" || key === "city" || key === "specialty") {
        canonical[key] = String(val).toLowerCase().trim().slice(0, 50);
      } else if (["page", "limit", "maxFee", "minRating", "radiusKm"].includes(key)) {
        canonical[key] = String(val).trim();
      } else {
        canonical[key] = String(val).toLowerCase().trim();
      }
    }
  }

  const sortedPairs = Object.keys(canonical)
    .sort()
    .map((k) => `${k}=${encodeURIComponent(canonical[k])}`)
    .join("&");

  return `medibook:doctors:list:v${version}:${sortedPairs || "all"}`;
}

// Cache Get with hit/miss counter
export async function cacheGet<T>(key: string): Promise<T | null> {
  if (redisAvailable && redisClient) {
    try {
      const raw = await redisClient.get(key);
      if (raw) {
        recordCacheHit();
        return JSON.parse(raw) as T;
      }
      recordCacheMiss();
      return null;
    } catch (err: any) {
      console.warn(`[Cache] Redis read failure on "${key}": ${err?.message || err}. Serving from DB.`);
    }
  } else if (!isDev) {
    recordCacheMiss();
    return null;
  }

  if (isDev) {
    const memRaw = memoryCache.get(key);
    if (memRaw) {
      recordCacheHit();
      return JSON.parse(memRaw) as T;
    }
    recordCacheMiss();
    return null;
  }

  recordCacheMiss();
  return null;
}

// Cache Set with TTL jitter ±10% to prevent stampedes
export async function cacheSet(key: string, value: any, ttlSeconds: number = 300): Promise<void> {
  const serialized = JSON.stringify(value);
  // Apply ±10% jitter
  const jitter = 0.9 + Math.random() * 0.2;
  const jitteredTtl = Math.max(1, Math.floor(ttlSeconds * jitter));

  if (redisAvailable && redisClient) {
    try {
      if (jitteredTtl > 0) {
        await redisClient.set(key, serialized, "EX", jitteredTtl);
      } else {
        await redisClient.set(key, serialized);
      }
      return;
    } catch (err: any) {
      console.warn(`[Cache] Redis write failure on "${key}": ${err?.message || err}.`);
    }
  }

  if (isDev) {
    memoryCache.set(key, serialized, jitteredTtl);
  }
}

// Slow reader race protection: set if version matches
export async function cacheSetWithVersion(
  scope: string,
  expectedVersion: number,
  key: string,
  value: any,
  ttlSeconds: number = 300
): Promise<boolean> {
  const currentVersion = await getCacheVersion(scope);
  if (currentVersion !== expectedVersion) {
    console.warn(`[Cache] Slow reader stale race detected for "${scope}" (expected v${expectedVersion}, current v${currentVersion}). Write discarded.`);
    return false;
  }

  await cacheSet(key, value, ttlSeconds);
  return true;
}

// Single-flight stampede protection per key
export async function getWithSingleFlight<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlSeconds: number = 300
): Promise<T> {
  const cached = await cacheGet<T>(key);
  if (cached !== null) {
    return cached;
  }

  const lockKey = `lock:${key}`;
  let lockAcquired = false;

  if (redisAvailable && redisClient) {
    try {
      const res = await redisClient.set(lockKey, "1", "PX", 3000, "NX");
      lockAcquired = res === "OK";
    } catch {
      lockAcquired = false;
    }
  } else {
    lockAcquired = true;
  }

  if (!lockAcquired) {
    // Another concurrent request holds the lock; wait and retry cache
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r, 60));
      const retry = await cacheGet<T>(key);
      if (retry !== null) {
        return retry;
      }
    }
  }

  try {
    const freshData = await fetcher();
    await cacheSet(key, freshData, ttlSeconds);
    return freshData;
  } finally {
    if (lockAcquired && redisAvailable && redisClient) {
      try {
        await redisClient.del(lockKey);
      } catch {}
    }
  }
}

export async function cacheDel(key: string): Promise<void> {
  if (redisAvailable && redisClient) {
    try {
      await redisClient.del(key);
    } catch (err: any) {
      console.warn(`[Cache] Redis del failure on "${key}": ${err?.message || err}.`);
    }
  }
  if (isDev) {
    memoryCache.del(key);
  }
}

// Batched SCAN instead of KEYS
export async function cacheDelPattern(pattern: string): Promise<void> {
  if (pattern.startsWith("medibook:doctors:list:")) {
    await incrCacheVersion("doctors:list");
    return;
  }

  if (redisAvailable && redisClient) {
    try {
      let cursor = "0";
      do {
        const [nextCursor, keys] = await redisClient.scan(cursor, "MATCH", pattern, "COUNT", 100);
        cursor = nextCursor;
        if (keys.length > 0) {
          await redisClient.del(...keys);
        }
      } while (cursor !== "0");
    } catch (err: any) {
      console.warn(`[Cache] Batched SCAN failure on "${pattern}":`, err?.message || err);
    }
  }
  if (isDev) {
    memoryCache.delPattern(pattern);
  }
}

export default {
  get: cacheGet,
  set: cacheSet,
  del: cacheDel,
  delPattern: cacheDelPattern,
  isConnected: isRedisConnected,
  getMetrics: getCacheMetrics,
  resetMetrics: resetCacheMetrics,
  getVersion: getCacheVersion,
  incrVersion: incrCacheVersion,
  normalizeDoctorQueryKey,
  getWithSingleFlight,
};
