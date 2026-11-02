import { describe, it, expect, beforeEach } from 'vitest';
import { AmbulanceService } from '../src/modules/ambulance/services/ambulance.service';

describe('Phase 6: Stale Driver Heartbeat TTL Eviction', () => {
  let ambulanceService: AmbulanceService;
  let purgedDrivers: string[];

  beforeEach(() => {
    purgedDrivers = [];

    const mockPrisma: any = {
      ambulanceRequest: {
        create: ({ data }: any) => ({ ...data, id: 'req-stale-test' }),
      },
    };

    const mockRedis: any = {
      getClient: () => ({
        georadius: async () => [
          ['driver-stale-ghost', '0.5'], // Closest, but heartbeat expired 5 minutes ago!
          ['driver-active-live', '1.8'],  // Second closest, active heartbeat!
        ],
        exists: async (key: string) => {
          // driver-stale-ghost has NO heartbeat in Redis
          if (key.includes('driver-stale-ghost')) return 0;
          if (key.includes('driver-active-live')) return 1;
          return 0;
        },
        zrem: async (_key: string, member: string) => {
          purgedDrivers.push(member);
          return 1;
        },
        setex: async () => 'OK',
      }),
    };

    ambulanceService = new AmbulanceService(mockPrisma, mockRedis);
  });

  it('evicts stale ghost driver with missing heartbeat and dispatches to active driver', async () => {
    const result = await ambulanceService.createRequest(
      'patient-1',
      22.5512,
      88.3524,
      'Park Street, Kolkata',
    );

    // Stale ghost driver was purged from Redis GEO
    expect(purgedDrivers).toContain('driver-stale-ghost');

    // Request was offered to active driver instead
    expect(result.matchedDriver).toBeDefined();
    expect(result.matchedDriver!.driverId).toBe('driver-active-live');
  });
});
