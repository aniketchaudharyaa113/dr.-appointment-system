import { describe, it, expect, beforeEach } from 'vitest';
import { AmbulanceService } from '../src/modules/ambulance/services/ambulance.service';

describe('Phase 6: 20-Second Offer Timeout and Cascading Reassignment', () => {
  let ambulanceService: AmbulanceService;

  const requestId = 'req-timeout-cascade';
  let requestRecord: any;
  let redisKeys: Map<string, string>;

  beforeEach(() => {
    redisKeys = new Map();
    requestRecord = {
      id: requestId,
      status: 'OFFERED',
      driverId: 'driver-1',
      pickupLat: 22.5726,
      pickupLng: 88.3639,
    };

    const mockPrisma: any = {
      ambulanceRequest: {
        findUnique: () => requestRecord,
        update: ({ data }: any) => {
          Object.assign(requestRecord, data);
          return requestRecord;
        },
      },
    };

    const mockRedis: any = {
      getClient: () => ({
        georadius: async () => [
          ['driver-1', '1.2'], // Timed-out driver (1.2 km away)
          ['driver-2', '2.5'], // Next available driver (2.5 km away)
          ['driver-3', '4.1'], // Third driver (4.1 km away)
        ],
        exists: async (key: string) => {
          // driver-2 and driver-3 have active heartbeats
          return key.includes('driver-2') || key.includes('driver-3') ? 1 : 0;
        },
        setex: async (key: string, _ttl: number, val: string) => {
          redisKeys.set(key, val);
          return 'OK';
        },
      }),
    };

    ambulanceService = new AmbulanceService(mockPrisma, mockRedis);
  });

  it('cascades offer to next nearest driver when 20-second offer to first driver expires', async () => {
    const result = await ambulanceService.handleOfferTimeout(requestId, 'driver-1');

    expect(result).toBeDefined();
    expect(result!.reassigned).toBe(true);
    expect(result!.nextDriverId).toBe('driver-2');

    // Request is now offered to driver-2
    expect(requestRecord.driverId).toBe('driver-2');
    expect(requestRecord.status).toBe('OFFERED');

    // Redis has a fresh 20-second offer key for driver-2
    expect(redisKeys.get(`ambulance:offer:${requestId}`)).toBe('driver-2');
  });

  it('marks request as EXPIRED when no further drivers are available within radius', async () => {
    // Override georadius with no other drivers
    const emptyRedis: any = {
      getClient: () => ({
        georadius: async () => [['driver-1', '1.2']],
        exists: async () => 0,
        setex: async () => 'OK',
      }),
    };

    const mockPrisma: any = {
      ambulanceRequest: {
        findUnique: () => requestRecord,
        update: ({ data }: any) => {
          Object.assign(requestRecord, data);
          return requestRecord;
        },
      },
    };

    const service = new AmbulanceService(mockPrisma, emptyRedis);
    const result = await service.handleOfferTimeout(requestId, 'driver-1');

    expect(result!.reassigned).toBe(false);
    expect(result!.status).toBe('EXPIRED');
    expect(requestRecord.status).toBe('EXPIRED');
  });
});
