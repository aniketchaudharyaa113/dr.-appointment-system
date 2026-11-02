import { describe, it, expect, beforeEach } from 'vitest';
import { WaitlistService } from '../src/modules/scheduling/services/waitlist.service';
import { BookingService } from '../src/modules/scheduling/services/booking.service';
import { PrismaService } from '../src/modules/platform/database/prisma.service';
import { RedisService } from '../src/modules/platform/redis/redis.service';

describe('Domain Rule: Waitlist 15-Minute Claim Offer Chain', () => {
  let waitlistService: WaitlistService;
  let waitlistsDb: any[];
  let redisHolds: Record<string, string>;

  beforeEach(() => {
    waitlistsDb = [];
    redisHolds = {};

    const mockPrisma: any = {
      waitlist: {
        findFirst: async ({ where }: any) => {
          return waitlistsDb.find(
            (w) => w.doctorId === where.doctorId && w.status === where.status,
          );
        },
        findUnique: async ({ where }: any) => {
          return waitlistsDb.find((w) => w.id === where.id);
        },
        update: async ({ where, data }: any) => {
          const item = waitlistsDb.find((w) => w.id === where.id);
          if (item) Object.assign(item, data);
          return item;
        },
      },
      outboxEvent: {
        create: async ({ data }: any) => ({ id: 'out-1', ...data }),
      },
    };

    const mockRedis: any = {
      acquireSlotHold: async (docId: string, slotTime: string, patientId: string) => {
        redisHolds[`${docId}:${slotTime}`] = patientId;
        return true;
      },
      getSlotHold: async (docId: string, slotTime: string) => {
        return redisHolds[`${docId}:${slotTime}`] || null;
      },
      releaseSlotHold: async (docId: string, slotTime: string) => {
        delete redisHolds[`${docId}:${slotTime}`];
        return true;
      },
    };

    const mockBookingService: any = {
      bookAppointment: async (docId: string, slotTime: string, patientId: string) => ({
        id: 'appt-claimed-1',
        doctorId: docId,
        patientId,
        slotTime: new Date(slotTime),
        status: 'CONFIRMED',
        bookingRef: 'MB-20270115-099',
      }),
    };

    waitlistService = new WaitlistService(
      mockPrisma as PrismaService,
      mockRedis as RedisService,
      mockBookingService as BookingService,
    );
  });

  it('cascades cancelled slot to next waitlisted patient with 15-minute lease and allows claim', async () => {
    const doctorId = 'doc-1';
    const slotTimeIso = '2027-01-15T14:00:00.000Z';

    // Seed waitlist entry for Patient 1
    const waitlistEntry = {
      id: 'wl-1',
      doctorId,
      patientId: 'patient-waitlist-1',
      slotDate: new Date('2027-01-15T00:00:00.000Z'),
      status: 'WAITING',
      createdAt: new Date('2027-01-10T10:00:00.000Z'),
    };
    waitlistsDb.push(waitlistEntry);

    // 1. Offer cancelled slot to next waitlisted patient
    const offer = await waitlistService.offerCancelledSlotToNext(doctorId, slotTimeIso);
    expect(offer).toBeDefined();
    expect(offer!.status).toBe('OFFERED');
    expect(offer!.claimExpiresAt).toBeDefined();

    // 2. Proves slot is held in Redis specifically for this patient
    expect(redisHolds[`${doctorId}:${slotTimeIso}`]).toBe('patient-waitlist-1');

    // 3. Patient claims offer within window
    const bookedAppt = await waitlistService.claimWaitlistOffer(
      waitlistEntry.id,
      'patient-waitlist-1',
    );

    expect(bookedAppt).toBeDefined();
    expect(bookedAppt.status).toBe('CONFIRMED');
    expect(bookedAppt.patientId).toBe('patient-waitlist-1');

    // Waitlist record is now CLAIMED
    expect(waitlistEntry.status).toBe('CLAIMED');
  });
});
