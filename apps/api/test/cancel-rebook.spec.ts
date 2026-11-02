import { describe, it, expect, beforeEach } from 'vitest';
import { BookingService } from '../src/modules/scheduling/services/booking.service';
import { PrismaService } from '../src/modules/platform/database/prisma.service';
import { RedisService } from '../src/modules/platform/redis/redis.service';
import { SlotService } from '../src/modules/scheduling/services/slot.service';
import { AuditService } from '../src/modules/platform/audit/audit.service';
import { ConflictException } from '@nestjs/common';

describe('Domain Rule: Cancel Then Immediate Rebook', () => {
  let bookingService: BookingService;
  let appointmentsDb: any[];

  beforeEach(() => {
    appointmentsDb = [];

    const mockPrisma: any = {
      doctor: {
        findUnique: async () => ({ id: 'doc-1', userId: 'doc-user-1', isVerified: true }),
      },
      appointment: {
        findUnique: async ({ where }: any) => {
          return appointmentsDb.find((a) => a.id === where.id);
        },
        create: async ({ data }: any) => {
          // Check active conflict
          const conflict = appointmentsDb.find(
            (a) =>
              a.doctorId === data.doctorId &&
              a.slotTime.getTime() === data.slotTime.getTime() &&
              ['PENDING_PAYMENT', 'CONFIRMED'].includes(a.status),
          );

          if (conflict) {
            const err: any = new Error('Unique constraint failed: idx_appointments_doctor_slot_active');
            err.code = 'P2002';
            throw err;
          }

          const appt = { id: `appt-${appointmentsDb.length + 1}`, ...data };
          appointmentsDb.push(appt);
          return appt;
        },
        update: async ({ where, data }: any) => {
          const item = appointmentsDb.find((a) => a.id === where.id);
          if (item) Object.assign(item, data);
          return item;
        },
      },
      consultationSession: {
        create: async () => ({ id: 'cs-1' }),
      },
      outboxEvent: {
        create: async () => ({ id: 'out-1' }),
      },
      $transaction: async (fn: any) => {
        const tx = {
          $queryRaw: async () => [{ last_seq: appointmentsDb.length + 1 }],
          appointment: mockPrisma.appointment,
          consultationSession: mockPrisma.consultationSession,
          outboxEvent: mockPrisma.outboxEvent,
        };
        return fn(tx);
      },
    };

    const mockRedis: any = {
      acquireSlotHold: async () => true,
      getSlotHold: async () => null,
      releaseSlotHold: async () => true,
    };

    const mockSlotService: any = {
      validateSlotAlignment: async () => ({ isValid: true }),
    };

    const mockAudit: any = {
      log: async () => {},
    };

    bookingService = new BookingService(
      mockPrisma as PrismaService,
      mockRedis as RedisService,
      mockSlotService as SlotService,
      mockAudit as AuditService,
    );
  });

  it('allows immediate rebooking of a cancelled slot by a new patient', async () => {
    const doctorId = 'doc-1';
    const slotTimeIso = '2027-01-15T11:00:00.000Z';

    // 1. Patient A books slot
    const apptA = await bookingService.bookAppointment(
      doctorId,
      slotTimeIso,
      'patient-A',
      'VIDEO',
    );
    expect(apptA.status).toBe('CONFIRMED');

    // 2. Patient B tries to book the same slot while active -> should conflict
    await expect(
      bookingService.bookAppointment(doctorId, slotTimeIso, 'patient-B', 'VIDEO'),
    ).rejects.toThrow(ConflictException);

    // 3. Patient A cancels the appointment
    const cancelled = await bookingService.cancelAppointment(
      apptA.id,
      'patient-A',
      'Emergency travel',
    );
    expect(cancelled.status).toBe('CANCELLED');

    // 4. Patient B now immediately books the freed slot -> MUST SUCCEED
    const apptB = await bookingService.bookAppointment(
      doctorId,
      slotTimeIso,
      'patient-B',
      'VIDEO',
    );
    expect(apptB.status).toBe('CONFIRMED');
    expect(apptB.patientId).toBe('patient-B');

    // Total rows in DB: 2 (one CANCELLED, one CONFIRMED)
    expect(appointmentsDb.length).toBe(2);
  });
});
