import Redis from "ioredis";
import dotenv from "dotenv";

dotenv.config();

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const isDev = process.env.NODE_ENV === "development";

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
    console.log("[Cache] Redis connected successfully on", REDIS_URL);
  });

  redisClient.on("error", () => {
    redisAvailable = false;
  });

  // Attempt non-blocking connection
  redisClient.connect().catch(() => {
    redisAvailable = false;
    if (isDev) {
      console.log("[Cache] Redis unavailable, using local development in-memory cache.");
    } else {
      console.log("[Cache] Redis unavailable. Operating in gracefully degraded mode directly against DB.");
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

export async function cacheGet<T>(key: string): Promise<T | null> {
  if (redisAvailable && redisClient) {
    try {
      const raw = await redisClient.get(key);
      if (raw) return JSON.parse(raw) as T;
      return null;
    } catch (err: any) {
      console.warn(`[Cache] Redis read failure on "${key}": ${err?.message || err}. Serving from DB.`);
    }
  } else if (!isDev) {
    // Multi-instance / production mode: degrade to DB, avoid serving stale per-instance memory
    return null;
  }

  if (isDev) {
    const memRaw = memoryCache.get(key);
    return memRaw ? (JSON.parse(memRaw) as T) : null;
  }

  return null;
}

export async function cacheSet(key: string, value: any, ttlSeconds: number = 300): Promise<void> {
  const serialized = JSON.stringify(value);
  if (redisAvailable && redisClient) {
    try {
      if (ttlSeconds > 0) {
        await redisClient.set(key, serialized, "EX", ttlSeconds);
      } else {
        await redisClient.set(key, serialized);
      }
      return;
    } catch (err: any) {
      console.warn(`[Cache] Redis write failure on "${key}": ${err?.message || err}.`);
    }
  }

  if (isDev) {
    memoryCache.set(key, serialized, ttlSeconds);
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

export async function cacheDelPattern(pattern: string): Promise<void> {
  if (redisAvailable && redisClient) {
    try {
      const keys = await redisClient.keys(pattern);
      if (keys.length > 0) {
        await redisClient.del(...keys);
      }
    } catch (err: any) {
      console.warn(`[Cache] Redis delPattern failure on "${pattern}": ${err?.message || err}.`);
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
};
