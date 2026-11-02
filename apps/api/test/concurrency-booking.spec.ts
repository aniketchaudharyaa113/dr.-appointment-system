import { describe, it, expect, beforeEach } from 'vitest';
import { BookingService } from '../src/modules/scheduling/services/booking.service';
import { PrismaService } from '../src/modules/platform/database/prisma.service';
import { RedisService } from '../src/modules/platform/redis/redis.service';
import { SlotService } from '../src/modules/scheduling/services/slot.service';
import { AuditService } from '../src/modules/platform/audit/audit.service';
import { ConflictException } from '@nestjs/common';

describe('Phase 3 - Concurrency Test: 50 Parallel Bookings', () => {
  let bookingService: BookingService;
  let appointmentsDb: any[];
  let dailyCounter: number;

  beforeEach(() => {
    appointmentsDb = [];
    dailyCounter = 0;

    const mockPrisma: any = {
      doctor: {
        findUnique: async () => ({ id: 'doc-1', isVerified: true }),
      },
      appointment: {
        findFirst: async ({ where }: any) => {
          return appointmentsDb.find(
            (a) =>
              a.doctorId === where.doctorId &&
              a.slotTime.getTime() === where.slotTime.getTime() &&
              ['PENDING_PAYMENT', 'CONFIRMED'].includes(a.status),
          );
        },
        create: async ({ data }: any) => {
          // Simulate PostgreSQL Partial Unique Index:
          // UNIQUE(doctor_id, slot_time) WHERE status IN ('PENDING_PAYMENT', 'CONFIRMED')
          const conflict = appointmentsDb.find(
            (a) =>
              a.doctorId === data.doctorId &&
              a.slotTime.getTime() === data.slotTime.getTime() &&
              ['PENDING_PAYMENT', 'CONFIRMED'].includes(a.status),
          );

          if (conflict) {
            const err: any = new Error(
              'Unique constraint failed on the constraint: idx_appointments_doctor_slot_active',
            );
            err.code = 'P2002';
            throw err;
          }

          const appt = { id: `appt-${appointmentsDb.length + 1}`, ...data };
          appointmentsDb.push(appt);
          return appt;
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
          $queryRaw: async () => {
            dailyCounter++;
            return [{ last_seq: dailyCounter }];
          },
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

  it('handles 50 parallel requests for the same slot: exactly 1 succeeds and 49 conflict', async () => {
    const doctorId = 'doc-1';
    const slotTimeIso = '2027-01-15T10:00:00.000Z';

    // 50 parallel booking attempts
    const promises = Array.from({ length: 50 }).map(async (_, idx) => {
      try {
        const appt = await bookingService.bookAppointment(
          doctorId,
          slotTimeIso,
          `patient-${idx + 1}`,
          'VIDEO',
        );
        return { success: true, appt };
      } catch (err) {
        if (err instanceof ConflictException) {
          return { success: false, conflict: true };
        }
        return { success: false, error: err };
      }
    });

    const results = await Promise.all(promises);

    const successful = results.filter((r) => r.success);
    const conflicted = results.filter((r) => r.conflict);

    // Assert Domain Rule 1: Zero double-booking
    expect(successful.length).toBe(1);
    expect(conflicted.length).toBe(49);
    expect(appointmentsDb.length).toBe(1);

    // Assert Domain Rule 4: Reference token format MB-YYYYMMDD-NNN
    const booked = successful[0]!.appt!;
    expect(booked.bookingRef).toMatch(/^MB-20270115-\d{3}$/);
    expect(booked.status).toBe('CONFIRMED');
  });
});
