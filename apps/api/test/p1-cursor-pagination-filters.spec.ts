import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  bootTestApp,
  resetDatabaseAndRedis,
  seedVerifiedDoctor,
  seedPatient,
  TestContext,
} from './helpers/test-app';
import { BookingService } from '../src/modules/scheduling/services/booking.service';

describe('P1-15: Cursor Pagination & Status/Date/Mode Filters for Appointment Lists', () => {
  let ctx: TestContext;
  let bookingService: BookingService;

  beforeAll(async () => {
    ctx = await bootTestApp();
    await resetDatabaseAndRedis(ctx.prisma, ctx.redisClient);
    bookingService = ctx.app.get(BookingService);
  });

  afterAll(async () => {
    if (ctx) await ctx.app.close();
  });

  it('paginates appointments using cursor and filters by status, mode, and date range', async () => {
    const { doctor } = await seedVerifiedDoctor(ctx.prisma);
    const patient = await seedPatient(ctx.prisma);

    const baseTime = new Date('2026-11-20T10:00:00.000Z');

    // Create 5 appointments with distinct times and metadata
    const apptData = [
      {
        bookingRef: `MB-P15-1`,
        slotTime: new Date(baseTime.getTime() + 1 * 3600 * 1000),
        status: 'CONFIRMED' as const,
        consultationMode: 'VIDEO' as const,
      },
      {
        bookingRef: `MB-P15-2`,
        slotTime: new Date(baseTime.getTime() + 2 * 3600 * 1000),
        status: 'CONFIRMED' as const,
        consultationMode: 'IN_CLINIC' as const,
      },
      {
        bookingRef: `MB-P15-3`,
        slotTime: new Date(baseTime.getTime() + 3 * 3600 * 1000),
        status: 'COMPLETED' as const,
        consultationMode: 'VIDEO' as const,
      },
      {
        bookingRef: `MB-P15-4`,
        slotTime: new Date(baseTime.getTime() + 4 * 3600 * 1000),
        status: 'COMPLETED' as const,
        consultationMode: 'CHAT' as const,
      },
      {
        bookingRef: `MB-P15-5`,
        slotTime: new Date(baseTime.getTime() + 5 * 3600 * 1000),
        status: 'CANCELLED' as const,
        consultationMode: 'VIDEO' as const,
      },
    ];

    for (const d of apptData) {
      await ctx.prisma.appointment.create({
        data: {
          bookingRef: d.bookingRef,
          doctorId: doctor.id,
          patientId: patient.id,
          slotTime: d.slotTime,
          status: d.status,
          consultationMode: d.consultationMode,
        },
      });
    }

    // 1. Test Cursor Pagination (Page 1 with limit: 2)
    const page1 = await bookingService.getMyAppointments(patient.id, 'PATIENT', { limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).toBeDefined();
    expect(page1.items[0].bookingRef).toBe('MB-P15-5'); // newest slotTime first

    // 2. Test Cursor Pagination (Page 2 with cursor from Page 1)
    const page2 = await bookingService.getMyAppointments(patient.id, 'PATIENT', {
      cursor: page1.nextCursor!,
      limit: 2,
    });
    expect(page2.items).toHaveLength(2);
    expect(page2.items[0].bookingRef).toBe('MB-P15-3');
    expect(page2.items[1].bookingRef).toBe('MB-P15-2');

    // 3. Test Status Filter (status: 'COMPLETED')
    const completedList = await bookingService.getMyAppointments(patient.id, 'PATIENT', {
      status: 'COMPLETED',
      limit: 10,
    });
    expect(completedList.items).toHaveLength(2);
    expect(completedList.items.every((a) => a.status === 'COMPLETED')).toBe(true);

    // 4. Test Mode Filter (mode: 'IN_CLINIC')
    const inClinicList = await bookingService.getMyAppointments(patient.id, 'PATIENT', {
      mode: 'IN_CLINIC',
      limit: 10,
    });
    expect(inClinicList.items).toHaveLength(1);
    expect(inClinicList.items[0].bookingRef).toBe('MB-P15-2');
    expect(inClinicList.items[0].consultationMode).toBe('IN_CLINIC');

    // 5. Test Date Range Filter
    const dateFiltered = await bookingService.getMyAppointments(patient.id, 'PATIENT', {
      fromDate: '2026-11-20',
      toDate: '2026-11-20',
      limit: 10,
    });
    expect(dateFiltered.items).toHaveLength(5);
  });
});
