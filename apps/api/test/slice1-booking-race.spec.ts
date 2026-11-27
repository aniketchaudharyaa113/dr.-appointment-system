import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import {
  bootTestApp,
  resetDatabaseAndRedis,
  seedVerifiedDoctor,
  seedPatient,
  signJwtForUser,
  TestContext,
} from './helpers/test-app';
import { BookingService } from '../src/modules/scheduling/services/booking.service';
import { SlotService } from '../src/modules/scheduling/services/slot.service';
import { istWallClockToUtcDate } from '../src/common/utils/ist-time';

describe('Slice 1: Real Postgres & Redis Booking, Holds, Concurrency & IST Timezone', () => {
  let ctx: TestContext;
  let bookingService: BookingService;
  let slotService: SlotService;

  beforeAll(async () => {
    ctx = await bootTestApp();
    bookingService = ctx.app.get(BookingService);
    slotService = ctx.app.get(SlotService);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await resetDatabaseAndRedis(ctx.prisma, ctx.redisClient);
  });

  it('50 parallel bookings against real Postgres partial unique index -> exactly 1 winner', async () => {
    const { doctor } = await seedVerifiedDoctor(ctx.prisma);
    const patients = await Promise.all(
      Array.from({ length: 50 }, (_, i) => seedPatient(ctx.prisma, `p${i}`)),
    );

    // Pick tomorrow at 10:00 IST
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const dateStr = tomorrow.toISOString().slice(0, 10);
    const slotDate = istWallClockToUtcDate(dateStr, '10:00');
    const slotIso = slotDate.toISOString();

    // 1. Test 50 parallel hold attempts via HTTP -> exactly 1 winner
    const holdResponses = await Promise.all(
      patients.map((p) =>
        ctx.app.inject({
          method: 'POST',
          url: '/api/appointments/hold',
          headers: { authorization: `Bearer ${signJwtForUser(p)}` },
          payload: { doctorId: doctor.id, slotTime: slotIso, consultationMode: 'VIDEO' },
        }),
      ),
    );
    const holdWinners = holdResponses.filter((r) => r.statusCode === 201);
    const holdConflicts = holdResponses.filter((r) => r.statusCode === 409);
    expect(holdWinners).toHaveLength(1);
    expect(holdConflicts).toHaveLength(49);

    // 2. Test 50 parallel DB appointment creations on the SAME slot -> partial unique index guarantees 1 winner
    const dbResults = await Promise.allSettled(
      patients.map((p, idx) =>
        ctx.prisma.appointment.create({
          data: {
            doctorId: doctor.id,
            patientId: p.id,
            slotTime: slotDate,
            status: 'PENDING_PAYMENT',
            bookingRef: `MB-RACE-${String(idx).padStart(3, '0')}`,
          },
        }),
      ),
    );

    const dbSuccesses = dbResults.filter((r) => r.status === 'fulfilled');
    const dbFailures = dbResults.filter((r) => r.status === 'rejected');
    expect(dbSuccesses).toHaveLength(1);
    expect(dbFailures).toHaveLength(49);

    const rowsInDb = await ctx.prisma.appointment.count({
      where: { doctorId: doctor.id, slotTime: slotDate },
    });
    expect(rowsInDb).toBe(1);
  });

  it('Hold token is unguessable in Redis, verified at booking, and booking creates PENDING_PAYMENT', async () => {
    const { doctor } = await seedVerifiedDoctor(ctx.prisma);
    const patientA = await seedPatient(ctx.prisma, 'alice');
    const patientB = await seedPatient(ctx.prisma, 'bob');

    const dateStr = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const slotIso = istWallClockToUtcDate(dateStr, '11:00').toISOString();

    const tokenA = signJwtForUser(patientA);
    const tokenB = signJwtForUser(patientB);

    // Hold slot as patientA
    const holdRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/appointments/hold',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { doctorId: doctor.id, slotTime: slotIso, consultationMode: 'VIDEO' },
    });
    expect(holdRes.statusCode).toBe(201);
    const holdBody = holdRes.json();
    expect(holdBody.holdToken).toMatch(/^[a-f0-9]{48}$/);

    // Verify Redis key format: hold:{doctor}:{slot} -> {token}:{patient}
    const rawRedisVal = await ctx.redisClient.get(`hold:${doctor.id}:${slotIso}`);
    expect(rawRedisVal).toBe(`${holdBody.holdToken}:${patientA.id}`);

    // Hold not owned -> rejected (patientB tries with patientA's holdToken)
    const stolenRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/appointments/book',
      headers: { authorization: `Bearer ${tokenB}` },
      payload: {
        doctorId: doctor.id,
        slotTime: slotIso,
        holdToken: holdBody.holdToken,
        consultationMode: 'VIDEO',
      },
    });
    expect(stolenRes.statusCode).toBe(403);

    // Wrong token by patientA -> rejected
    const forgedRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/appointments/book',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        doctorId: doctor.id,
        slotTime: slotIso,
        holdToken: 'forged_token_that_is_long_enough_1234',
        consultationMode: 'VIDEO',
      },
    });
    expect(forgedRes.statusCode).toBe(403);

    // Valid booking with idempotencyKey -> PENDING_PAYMENT
    const idemKey = randomUUID();
    const bookRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/appointments/book',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        doctorId: doctor.id,
        slotTime: slotIso,
        holdToken: holdBody.holdToken,
        consultationMode: 'VIDEO',
        idempotencyKey: idemKey,
      },
    });
    expect(bookRes.statusCode).toBe(201);
    const appt = bookRes.json();
    expect(appt.status).toBe('PENDING_PAYMENT');
    expect(appt.bookingRef).toMatch(/^MB-\d{8}-001$/);

    // Redis hold was released upon booking
    const afterBookRedis = await ctx.redisClient.get(`hold:${doctor.id}:${slotIso}`);
    expect(afterBookRedis).toBeNull();

    // Idempotency replay returns the exact same appointment
    const replayRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/appointments/book',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        doctorId: doctor.id,
        slotTime: slotIso,
        holdToken: holdBody.holdToken,
        consultationMode: 'VIDEO',
        idempotencyKey: idemKey,
      },
    });
    expect(replayRes.statusCode).toBe(201);
    expect(replayRes.json().id).toBe(appt.id);
  });

  it('Cancel-then-rebook immediately frees slot in partial unique index', async () => {
    const { doctor } = await seedVerifiedDoctor(ctx.prisma);
    const patientA = await seedPatient(ctx.prisma, 'pA');
    const patientB = await seedPatient(ctx.prisma, 'pB');

    const dateStr = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const slotIso = istWallClockToUtcDate(dateStr, '14:00').toISOString();

    const holdA = await bookingService.holdSlot(doctor.id, slotIso, patientA.id);
    const apptA = await bookingService.bookAppointment(
      doctor.id,
      slotIso,
      patientA.id,
      holdA.holdToken,
    );
    expect(apptA.status).toBe('PENDING_PAYMENT');

    // Cancel A
    const cancelRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/appointments/${apptA.id}/cancel`,
      headers: { authorization: `Bearer ${signJwtForUser(patientA)}` },
      payload: { reason: 'Schedule changed' },
    });
    expect(cancelRes.statusCode).toBe(201);
    expect(cancelRes.json().status).toBe('CANCELLED');

    // Patient B holds and rebooks the exact same slot
    const holdB = await bookingService.holdSlot(doctor.id, slotIso, patientB.id);
    const apptB = await bookingService.bookAppointment(
      doctor.id,
      slotIso,
      patientB.id,
      holdB.holdToken,
    );
    expect(apptB.status).toBe('PENDING_PAYMENT');
    expect(apptB.id).not.toBe(apptA.id);
  });

  it('Expiry job releases unpaid PENDING_PAYMENT appointments after N minutes', async () => {
    const { doctor } = await seedVerifiedDoctor(ctx.prisma);
    const patientA = await seedPatient(ctx.prisma, 'expA');
    const patientB = await seedPatient(ctx.prisma, 'expB');

    const dateStr = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const slotIso = istWallClockToUtcDate(dateStr, '15:00').toISOString();

    const holdA = await bookingService.holdSlot(doctor.id, slotIso, patientA.id);
    const apptA = await bookingService.bookAppointment(
      doctor.id,
      slotIso,
      patientA.id,
      holdA.holdToken,
    );

    // Backdate created_at by 20 minutes
    await ctx.prisma.$executeRaw`
      UPDATE appointments SET created_at = NOW() - INTERVAL '20 minutes' WHERE id = ${apptA.id}::uuid
    `;

    const released = await bookingService.releaseExpiredPendingAppointments(15);
    expect(released).toBe(1);

    const updated = await ctx.prisma.appointment.findUnique({ where: { id: apptA.id } });
    expect(updated?.status).toBe('CANCELLED');
    expect(updated?.cancellationReason).toBe('Payment window expired');

    // Another patient can now hold and book that slot
    const holdB = await bookingService.holdSlot(doctor.id, slotIso, patientB.id);
    const apptB = await bookingService.bookAppointment(
      doctor.id,
      slotIso,
      patientB.id,
      holdB.holdToken,
    );
    expect(apptB.status).toBe('PENDING_PAYMENT');
  });

  it('Asia/Kolkata wall-clock slots and midnight IST daily booking reference rollover', async () => {
    const { doctor } = await seedVerifiedDoctor(ctx.prisma);

    // 1. Verify slots for 2026-12-01 IST start at 09:00 IST = 03:30 UTC
    const slots = await slotService.getDoctorSlotsForDate(doctor.id, '2026-12-01');
    expect(slots.length).toBeGreaterThan(0);
    expect(slots[0].displayTime).toBe('09:00');
    expect(slots[0].slotTime).toBe('2026-12-01T03:30:00.000Z');

    // 2. Test midnight IST rollover:
    //    2026-11-25 23:45 IST == 2026-11-25T18:15:00.000Z -> MB-20261125-001
    //    2026-11-26 00:15 IST == 2026-11-25T18:45:00.000Z (SAME UTC date 2026-11-25, NEXT IST date 2026-11-26!) -> MB-20261126-001
    const beforeMidnightIst = new Date('2026-11-25T23:45:00.000+05:30');
    const afterMidnightIst = new Date('2026-11-26T00:15:00.000+05:30');

    expect(beforeMidnightIst.toISOString().slice(0, 10)).toBe('2026-11-25');
    expect(afterMidnightIst.toISOString().slice(0, 10)).toBe('2026-11-25');

    const ref1 = await ctx.prisma.$transaction((tx) =>
      bookingService.generateDailyReferenceToken(doctor.id, beforeMidnightIst, tx),
    );
    const ref2 = await ctx.prisma.$transaction((tx) =>
      bookingService.generateDailyReferenceToken(doctor.id, afterMidnightIst, tx),
    );

    expect(ref1).toBe('MB-20261125-001');
    expect(ref2).toBe('MB-20261126-001');
  });

  it('allocates unique daily bookingRef values across different doctors on the same IST date', async () => {
    const { doctor: doctorA } = await seedVerifiedDoctor(ctx.prisma, {
      specialty: 'Cardiology',
    });
    const { doctor: doctorB } = await seedVerifiedDoctor(ctx.prisma, {
      specialty: 'Dermatology',
    });
    const patientA = await seedPatient(ctx.prisma, 'multi-doc-a@test.com');
    const patientB = await seedPatient(ctx.prisma, 'multi-doc-b@test.com');

    const slotsA = await slotService.getDoctorSlotsForDate(doctorA.id, '2026-12-02');
    const slotsB = await slotService.getDoctorSlotsForDate(doctorB.id, '2026-12-02');

    const holdA = await bookingService.holdSlot(doctorA.id, slotsA[0].slotTime, patientA.id);
    const apptA = await bookingService.bookAppointment(
      doctorA.id,
      slotsA[0].slotTime,
      patientA.id,
      holdA.holdToken,
    );

    const holdB = await bookingService.holdSlot(doctorB.id, slotsB[0].slotTime, patientB.id);
    const apptB = await bookingService.bookAppointment(
      doctorB.id,
      slotsB[0].slotTime,
      patientB.id,
      holdB.holdToken,
    );

    expect(apptA.bookingRef).toBe('MB-20261202-001');
    expect(apptB.bookingRef).toBe('MB-20261202-002');
    expect(apptA.bookingRef).not.toBe(apptB.bookingRef);
  });
});
