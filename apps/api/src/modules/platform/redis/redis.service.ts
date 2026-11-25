import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { env } from '../../../common/config/env.schema';
import { logger } from '../../../common/logger/pino-logger.service';

export interface ParsedSlotHold {
  token: string;
  patientId: string;
}

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client!: Redis;

  onModuleInit() {
    this.client = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      retryStrategy(times) {
        return Math.min(times * 100, 3000);
      },
    });

    this.client.on('connect', () => {
      logger.info('Connected to Redis');
    });

    this.client.on('error', (err) => {
      logger.error({ err }, 'Redis connection error');
    });
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit();
      logger.info('Disconnected from Redis');
    }
  }

  getClient(): Redis {
    return this.client;
  }

  async ping(): Promise<boolean> {
    try {
      const res = await this.client.ping();
      return res === 'PONG';
    } catch {
      return false;
    }
  }

  private holdKey(doctorId: string, slotTimeIso: string): string {
    return `hold:${doctorId}:${slotTimeIso}`;
  }

  /**
   * Acquire a 10-minute slot hold lease with an unguessable token:
   * SET hold:{doctor}:{slot} {token}:{patient} NX EX 600
   */
  async acquireSlotHold(
    doctorId: string,
    slotTimeIso: string,
    patientId: string,
    token: string,
    ttlSeconds = 600,
  ): Promise<boolean> {
    const key = this.holdKey(doctorId, slotTimeIso);
    const value = `${token}:${patientId}`;
    const res = await this.client.set(key, value, 'EX', ttlSeconds, 'NX');
    return res === 'OK';
  }

  async getSlotHold(
    doctorId: string,
    slotTimeIso: string,
  ): Promise<ParsedSlotHold | null> {
    const key = this.holdKey(doctorId, slotTimeIso);
    const raw = await this.client.get(key);
    if (!raw) return null;
    const sepIndex = raw.lastIndexOf(':');
    if (sepIndex <= 0) return null;
    return {
      token: raw.slice(0, sepIndex),
      patientId: raw.slice(sepIndex + 1),
    };
  }

  async refreshSlotHoldTtl(
    doctorId: string,
    slotTimeIso: string,
    token: string,
    patientId: string,
    ttlSeconds = 600,
  ): Promise<boolean> {
    const key = this.holdKey(doctorId, slotTimeIso);
    const expected = `${token}:${patientId}`;
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("expire", KEYS[1], tonumber(ARGV[2]))
      else
        return 0
      end
    `;
    const res = await this.client.eval(script, 1, key, expected, String(ttlSeconds));
    return res === 1;
  }

  async releaseSlotHold(
    doctorId: string,
    slotTimeIso: string,
    token?: string,
    patientId?: string,
  ): Promise<boolean> {
    const key = this.holdKey(doctorId, slotTimeIso);
    if (token && patientId) {
      const expected = `${token}:${patientId}`;
      const script = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;
      const res = await this.client.eval(script, 1, key, expected);
      return res === 1;
    }
    const res = await this.client.del(key);
    return res > 0;
  }

  // --- Idempotency Keys (24h TTL) ---
  async getIdempotency<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(`idem:${key}`);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async setIdempotency(
    key: string,
    value: unknown,
    ttlSeconds = 86400,
  ): Promise<void> {
    await this.client.set(`idem:${key}`, JSON.stringify(value), 'EX', ttlSeconds);
  }

  async acquireIdempotencyLock(key: string, ttlSeconds = 15): Promise<boolean> {
    const res = await this.client.set(`idem:lock:${key}`, '1', 'EX', ttlSeconds, 'NX');
    return res === 'OK';
  }

  async releaseIdempotencyLock(key: string): Promise<void> {
    await this.client.del(`idem:lock:${key}`);
  }

  // --- Distributed Locks ---
  async acquireLock(key: string, lockValue: string, ttlSeconds = 10): Promise<boolean> {
    const res = await this.client.set(`lock:${key}`, lockValue, 'EX', ttlSeconds, 'NX');
    return res === 'OK';
  }

  async releaseLock(key: string, lockValue: string): Promise<boolean> {
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    const res = await this.client.eval(script, 1, `lock:${key}`, lockValue);
    return res === 1;
  }

  // --- Ambulance Driver Redis GEO Tracking ---
  async updateDriverLocation(
    driverId: string,
    longitude: number,
    latitude: number,
    heartbeatTtl = 15,
  ): Promise<void> {
    const pipeline = this.client.pipeline();
    pipeline.geoadd('drivers:locations', longitude, latitude, driverId);
    pipeline.set(`driver:heartbeat:${driverId}`, 'online', 'EX', heartbeatTtl);
    await pipeline.exec();
  }

  async findNearbyDrivers(
    longitude: number,
    latitude: number,
    radiusKm = 10,
    count = 5,
  ): Promise<Array<{ driverId: string; distanceKm: number }>> {
    try {
      const results = (await (this.client as any).geosearch(
        'drivers:locations',
        'FROMLONLAT',
        longitude,
        latitude,
        'BYRADIUS',
        radiusKm,
        'km',
        'WITHDIST',
        'ASC',
        'COUNT',
        count,
      )) as Array<[string, string]>;

      if (!results || !Array.isArray(results)) return [];

      return results.map(([driverId, dist]) => ({
        driverId,
        distanceKm: parseFloat(dist),
      }));
    } catch {
      return [];
    }
  }

  async removeDriver(driverId: string): Promise<void> {
    const pipeline = this.client.pipeline();
    pipeline.zrem('drivers:locations', driverId);
    pipeline.del(`driver:heartbeat:${driverId}`);
    await pipeline.exec();
  }
}
