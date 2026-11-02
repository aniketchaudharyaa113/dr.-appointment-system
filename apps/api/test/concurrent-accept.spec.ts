import { describe, it, expect, beforeEach } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { AmbulanceService } from '../src/modules/ambulance/services/ambulance.service';

describe('Phase 6: Concurrent Accept Single-Winner Race', () => {
  let ambulanceService: AmbulanceService;

  const requestId = 'req-race-1';
  let requestStatus = 'OFFERED';
  let assignedDriverId = 'driver-offered-1';

  beforeEach(() => {
    requestStatus = 'OFFERED';
    assignedDriverId = 'driver-offered-1';

    const mockPrisma: any = {
      ambulanceDriverProfile: {
        findUnique: ({ where }: any) => {
          return {
            id: where.userId === 'user-driver-1' ? 'driver-offered-1' : `driver-${where.userId}`,
            userId: where.userId,
            vehicleNumber: 'WB-02-AM-1001',
          };
        },
      },
      ambulanceRequest: {
        updateMany: ({ where, data }: any) => {
          // Atomic conditional update simulation
          if (
            where.id === requestId &&
            where.status === requestStatus &&
            where.driverId === assignedDriverId &&
            requestStatus === 'OFFERED'
          ) {
            requestStatus = data.status;
            return { count: 1 };
          }
          return { count: 0 };
        },
      },
    };

    const mockRedis: any = {
      getClient: () => ({
        del: async () => 1,
      }),
    };

    ambulanceService = new AmbulanceService(mockPrisma, mockRedis);
  });

  it('guarantees that exactly one driver accepts the offer and concurrent claims fail with ConflictException', async () => {
    // 10 concurrent accept attempts
    const attempts = Array.from({ length: 10 }).map(
      (_, i): Promise<{ success: boolean; res?: any; err?: any }> =>
        ambulanceService
          .acceptRequest(requestId, i === 0 ? 'user-driver-1' : `user-driver-${i + 1}`)
          .then((res) => ({ success: true, res }))
          .catch((err) => ({ success: false, err })),
    );


    const results = await Promise.all(attempts);

    const winners = results.filter((r) => r.success);
    const losers = results.filter((r) => !r.success);

    expect(winners.length).toBe(1);
    expect(losers.length).toBe(9);

    expect(winners[0].res!.status).toBe('ACCEPTED');
    for (const loser of losers) {
      expect(loser.err).toBeInstanceOf(ConflictException);
    }
  });
});
