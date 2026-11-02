import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { env } from '../../../common/config/env.schema';
import { logger } from '../../../common/logger/pino-logger.service';

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

  // --- Slot Holds (10-minute hold lease) ---
  async acquireSlotHold(
    doctorId: string,
    slotTimeIso: string,
    patientId: string,
    ttlSeconds = 600,
  ): Promise<boolean> {
    const key = `slot:hold:${doctorId}:${slotTimeIso}`;
    const res = await this.client.set(key, patientId, 'EX', ttlSeconds, 'NX');
    return res === 'OK';
  }

  async getSlotHold(doctorId: string, slotTimeIso: string): Promise<string | null> {
    const key = `slot:hold:${doctorId}:${slotTimeIso}`;
    return this.client.get(key);
  }

  async releaseSlotHold(doctorId: string, slotTimeIso: string): Promise<boolean> {
    const key = `slot:hold:${doctorId}:${slotTimeIso}`;
    const res = await this.client.del(key);
    return res > 0;
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
    // GEOSEARCH drivers:locations FROMLONLAT lng lat BYRADIUS radiusKm km WITHDIST ASC COUNT count
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
