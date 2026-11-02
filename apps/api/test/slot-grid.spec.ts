import { describe, it, expect } from 'vitest';
import { SlotService } from '../src/modules/scheduling/services/slot.service';
import { PrismaService } from '../src/modules/platform/database/prisma.service';
import { RedisService } from '../src/modules/platform/redis/redis.service';

describe('Domain Rule: Slot Grid & Duration Alignment', () => {
  it('generates exact discrete slots adhering to duration grid and working window', async () => {
    const mockPrisma: any = {
      availability: {
        findMany: async () => [
          {
            doctorId: 'doc-1',
            dayOfWeek: 5, // Friday
            startTime: '09:00:00',
            endTime: '11:00:00',
            slotDurationMinutes: 15,
          },
        ],
      },
      doctorLeave: {
        findFirst: async () => null,
      },
      appointment: {
        findMany: async () => [],
      },
    };

    const mockRedis: any = {
      getSlotHold: async () => null,
      getClient: () => null,
    };

    const slotService = new SlotService(
      mockPrisma as PrismaService,
      mockRedis as RedisService,
    );

    // 2027-01-15 is a Friday (day 5)
    const slots = await slotService.getDoctorSlotsForDate('doc-1', '2027-01-15');

    // 2 hours (120 minutes) / 15 minutes = 8 discrete slots
    expect(slots.length).toBe(8);

    const displayTimes = slots.map((s) => s.displayTime);
    expect(displayTimes).toEqual([
      '09:00',
      '09:15',
      '09:30',
      '09:45',
      '10:00',
      '10:15',
      '10:30',
      '10:45',
    ]);

    // All slots must be initially available
    expect(slots.every((s) => s.isAvailable)).toBe(true);

    // Check slot validation
    const validSlot = new Date('2027-01-15T09:30:00.000Z');
    const validRes = await slotService.validateSlotAlignment('doc-1', validSlot);
    expect(validRes.isValid).toBe(true);

    // Misaligned slot (e.g. 09:07)
    const invalidSlot = new Date('2027-01-15T09:07:00.000Z');
    const invalidRes = await slotService.validateSlotAlignment('doc-1', invalidSlot);
    expect(invalidRes.isValid).toBe(false);
  });
});
