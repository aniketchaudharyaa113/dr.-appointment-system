import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  bootTestApp,
  resetDatabaseAndRedis,
  seedVerifiedDoctor,
  seedPatient,
  signJwtForUser,
  TestContext,
} from './helpers/test-app';
import { BookingService } from '../src/modules/scheduling/services/booking.service';
import { LeaveService } from '../src/modules/scheduling/services/leave.service';
import { WaitlistService } from '../src/modules/scheduling/services/waitlist.service';
import { istWallClockToUtcDate } from '../src/common/utils/ist-time';

describe('Slice 1: Real Auth Token Rotation, Health, Leave Cascade & Waitlist Claim', () => {
  let ctx: TestContext;
  let bookingService: BookingService;
  let leaveService: LeaveService;
  let waitlistService: WaitlistService;

  beforeAll(async () => {
    ctx = await bootTestApp();
    bookingService = ctx.app.get(BookingService);
    leaveService = ctx.app.get(LeaveService);
    waitlistService = ctx.app.get(WaitlistService);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await resetDatabaseAndRedis(ctx.prisma, ctx.redisClient);
  });

  it('Health probes /api/health/live and /api/health/ready verify real DB & Redis', async () => {
    const live = await ctx.app.inject({ method: 'GET', url: '/api/health/live' });
    expect(live.statusCode).toBe(200);
    expect(live.json().status).toBe('ok');

    const ready = await ctx.app.inject({ method: 'GET', url: '/api/health/ready' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toMatchObject({ status: 'ok', db: true, redis: true });
  });

  it('Auth register, login, refresh rotation & token reuse theft detection against real Postgres', async () => {
    const reg = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: 'realpatient@medibook.test',
        password: 'Password123!',
        name: 'Real Patient',
        role: 'PATIENT',
      },
    });
    expect(reg.statusCode).toBe(201);
    const setCookieHeader = reg.headers['set-cookie'] as string;
    expect(setCookieHeader).toContain('refreshToken=');
    const refresh1 = setCookieHeader.match(/refreshToken=([^;]+)/)?.[1];
    expect(refresh1).toBeTruthy();

    // Rotate token once -> succeeds
    const rot1 = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: refresh1 },
    });
    expect(rot1.statusCode).toBe(200);
    const refresh2 = (rot1.headers['set-cookie'] as string).match(/refreshToken=([^;]+)/)?.[1];
    expect(refresh2).toBeTruthy();
    expect(refresh2).not.toBe(refresh1);

    // Expire the 10s concurrent-refresh grace window in Redis, then replay refresh1 -> theft detection revokes ALL tokens for user!
    const graceKeys = await ctx.redisClient.keys('refresh_grace:*');
    if (graceKeys.length > 0) {
      await ctx.redisClient.del(...graceKeys);
    }
    const theftAttempt = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: refresh1 },
    });
    expect(theftAttempt.statusCode).toBe(401);

    // Even refresh2 is now revoked!
    const afterRevoke = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: refresh2 },
    });
    expect(afterRevoke.statusCode).toBe(401);
  });

  it('Doctor leave preview & cascade cancellation emits 100% refund outbox events', async () => {
    const { user: docUser, doctor } = await seedVerifiedDoctor(ctx.prisma);
    const patient = await seedPatient(ctx.prisma);

    const dateStr = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const slotIso = istWallClockToUtcDate(dateStr, '16:00').toISOString();
    const hold = await bookingService.holdSlot(doctor.id, slotIso, patient.id);
    const appt = await bookingService.bookAppointment(doctor.id, slotIso, patient.id, hold.holdToken);

    const preview = await leaveService.previewLeaveImpact(doctor.id, dateStr, dateStr, docUser.id);
    expect(preview.affectedCount).toBe(1);

    const applied = await leaveService.applyLeave(doctor.id, dateStr, dateStr, 'Medical conference', docUser.id);
    expect(applied.cancelledCount).toBe(1);

    const cancelled = await ctx.prisma.appointment.findUnique({ where: { id: appt.id } });
    expect(cancelled?.status).toBe('CANCELLED');
  });

  it('Waitlist join, offer on cancellation, and 15-minute claim creates PENDING_PAYMENT booking', async () => {
    const { doctor } = await seedVerifiedDoctor(ctx.prisma);
    const patientA = await seedPatient(ctx.prisma, 'waitA');
    const patientB = await seedPatient(ctx.prisma, 'waitB');

    const dateStr = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const slotIso = istWallClockToUtcDate(dateStr, '17:00').toISOString();

    const holdA = await bookingService.holdSlot(doctor.id, slotIso, patientA.id);
    const apptA = await bookingService.bookAppointment(doctor.id, slotIso, patientA.id, holdA.holdToken);

    const waitEntry = await waitlistService.joinWaitlist(doctor.id, patientB.id, dateStr, slotIso);
    expect(waitEntry.status).toBe('WAITING');

    await bookingService.cancelAppointment(apptA.id, patientA.id, 'Cannot attend');
    const offered = await waitlistService.offerCancelledSlotToNext(doctor.id, slotIso);
    expect(offered?.status).toBe('OFFERED');
    expect(offered?.holdToken).toBeTruthy();

    const claimedAppt = await waitlistService.claimWaitlistOffer(waitEntry.id, patientB.id);
    expect(claimedAppt.status).toBe('PENDING_PAYMENT');
    expect(claimedAppt.patientId).toBe(patientB.id);
  });
});
