import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createHmac, randomUUID } from 'crypto';
import {
  bootTestApp,
  resetDatabaseAndRedis,
  seedVerifiedDoctor,
  seedPatient,
  TestContext,
} from './helpers/test-app';
import { BookingService } from '../src/modules/scheduling/services/booking.service';
import { WaitlistService } from '../src/modules/scheduling/services/waitlist.service';
import { PaymentService } from '../src/modules/payments/services/payment.service';
import { LedgerService } from '../src/modules/payments/services/ledger.service';
import {
  istWallClockToUtcDate,
  getIstDateString,
  getIstDayBoundsUtc,
} from '../src/common/utils/ist-time';
import { env } from '../src/common/config/env.schema';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

describe('WS3: Scheduling, Locking, Waitlist, Timezone & BookingRef Integrity (B8, B10, B14, B16, B17, B18)', () => {
  let ctx: TestContext;
  let bookingService: BookingService;
  let waitlistService: WaitlistService;
  let paymentService: PaymentService;
  let ledgerService: LedgerService;

  beforeAll(async () => {
    ctx = await bootTestApp();
    bookingService = ctx.app.get(BookingService);
    waitlistService = ctx.app.get(WaitlistService);
    paymentService = ctx.app.get(PaymentService);
    ledgerService = ctx.app.get(LedgerService);
  });

  afterAll(async () => {
    if (ctx) await ctx.app.close();
  });

  beforeEach(async () => {
    await resetDatabaseAndRedis(ctx.prisma, ctx.redisClient);
  });

  it('B8: handles 20 concurrent cancelAppointment + CAPTURED webhook races with zero deadlocks', async () => {
    const { doctor } = await seedVerifiedDoctor(ctx.prisma);
    const futureBase = Date.now() + 72 * 60 * 60 * 1000;

    const pairs = await Promise.all(
      Array.from({ length: 20 }, async (_, idx) => {
        const patient = await seedPatient(ctx.prisma, `ws3-b8-${idx}`);
        const slotTime = new Date(futureBase + idx * 15 * 60 * 1000);
        const appt = await ctx.prisma.appointment.create({
          data: {
            bookingRef: `MB-B8-${idx}-${Date.now().toString(36)}`,
            doctorId: doctor.id,
            patientId: patient.id,
            slotTime,
            status: 'PENDING_PAYMENT',
            consultationMode: 'VIDEO',
          },
        });
        const payment = await ctx.prisma.payment.create({
          data: {
            appointmentId: appt.id,
            provider: 'FAKE',
            providerOrderId: `ord_b8_${idx}_${Date.now()}`,
            amountPaise: 50000,
            status: 'INITIATED',
            idempotencyKey: randomUUID(),
          },
        });
        return { patient, appt, payment };
      }),
    );

    const results = await Promise.allSettled(
      pairs.flatMap(({ patient, appt, payment }, idx) => {
        const rawWebhook = JSON.stringify({
          event: 'payment.captured',
          orderId: payment.providerOrderId,
          paymentId: `pay_b8_${idx}`,
          amountPaise: 50000,
        });
        const sig = createHmac('sha256', env.PAYMENT_WEBHOOK_SECRET || '')
          .update(rawWebhook)
          .digest('hex');
        return [
          bookingService.cancelAppointment(appt.id, patient.id, 'Concurrent cancel'),
          paymentService.processWebhook(rawWebhook, sig, `evt_b8_${idx}`),
        ];
      }),
    );

    const deadlockErrors = results.filter(
      (r) =>
        r.status === 'rejected' &&
        (String((r.reason as Error)?.message).includes('40P01') ||
          String((r.reason as Error)?.message).toLowerCase().includes('deadlock')),
    );
    expect(deadlockErrors).toHaveLength(0);

    for (const { payment } of pairs) {
      const balanced = await ledgerService.verifyZeroSum(payment.id);
      expect(balanced).toBe(true);
    }
  });

  it('B10: Waitlist matches slotTime, verifies DB slot free, atomic SKIP LOCKED, protects CLAIMED, expires dead holds', async () => {
    const { doctor } = await seedVerifiedDoctor(ctx.prisma);
    const patientA = await seedPatient(ctx.prisma, 'wl-a');
    const patientB = await seedPatient(ctx.prisma, 'wl-b-11am');
    const patientC = await seedPatient(ctx.prisma, 'wl-c-10am');

    const futureDate = new Date(Date.now() + 72 * 60 * 60 * 1000);
    const dateStr = getIstDateString(futureDate);
    const slot10am = istWallClockToUtcDate(dateStr, '10:00').toISOString();
    const slot11am = istWallClockToUtcDate(dateStr, '11:00').toISOString();

    // Book both slots so patients can join waitlist
    const hold10 = await bookingService.holdSlot(doctor.id, slot10am, patientA.id);
    const appt10 = await bookingService.bookAppointment(doctor.id, slot10am, patientA.id, hold10.holdToken);
    const hold11 = await bookingService.holdSlot(doctor.id, slot11am, patientA.id);
    await bookingService.bookAppointment(doctor.id, slot11am, patientA.id, hold11.holdToken);

    // Patient B joined FIRST, specifically for 11:00
    const waitB = await waitlistService.joinWaitlist(doctor.id, patientB.id, dateStr, slot11am);
    // Patient C joined SECOND, specifically for 10:00
    const waitC = await waitlistService.joinWaitlist(doctor.id, patientC.id, dateStr, slot10am);

    // While 10:00 is STILL BOOKED in DB, offering it must return null
    const prematureOffer = await waitlistService.offerCancelledSlotToNext(doctor.id, slot10am);
    expect(prematureOffer).toBeNull();

    // Cancel 10:00 -> MUST offer to Patient C (10:00), NOT Patient B (11:00)!
    await bookingService.cancelAppointment(appt10.id, patientA.id, 'Free 10am');
    const offer10 = await waitlistService.offerCancelledSlotToNext(doctor.id, slot10am);
    expect(offer10?.id).toBe(waitC.id);
    expect(offer10?.patientId).toBe(patientC.id);
    expect(offer10?.slotTime).toBe(slot10am);

    // Patient B stayed WAITING for 11:00
    const reloadedB = await ctx.prisma.waitlist.findUnique({ where: { id: waitB.id } });
    expect(reloadedB?.status).toBe('WAITING');

    // If Redis hold disappears before claimWaitlistOffer -> claim fails & status becomes EXPIRED (not OFFERED)
    await ctx.redisClient.del(`hold:${doctor.id}:${slot10am}`);
    await expect(
      waitlistService.claimWaitlistOffer(waitC.id, patientC.id),
    ).rejects.toThrow();
    const expiredC = await ctx.prisma.waitlist.findUnique({ where: { id: waitC.id } });
    expect(expiredC?.status).toBe('EXPIRED');

    // leaveWaitlist cannot overwrite a CLAIMED entry
    await ctx.prisma.waitlist.update({
      where: { id: waitB.id },
      data: { status: 'CLAIMED' },
    });
    await expect(
      waitlistService.leaveWaitlist(waitB.id, patientB.id),
    ).rejects.toThrow(BadRequestException);
    const stillClaimedB = await ctx.prisma.waitlist.findUnique({ where: { id: waitB.id } });
    expect(stillClaimedB?.status).toBe('CLAIMED');
  });

  it('B14: blocks slot lookup, holds, and bookings for deactivated or unverified doctors', async () => {
    const { doctor, user: docUser } = await seedVerifiedDoctor(ctx.prisma);
    const patient = await seedPatient(ctx.prisma, 'b14-patient');

    const futureDate = new Date(Date.now() + 72 * 60 * 60 * 1000);
    const dateStr = getIstDateString(futureDate);
    const slotIso = istWallClockToUtcDate(dateStr, '10:00').toISOString();

    // Deactivate doctor user (isVerified remains true!)
    await ctx.prisma.user.update({
      where: { id: docUser.id },
      data: { isActive: false },
    });

    const slotsRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/doctors/${doctor.id}/slots?date=${dateStr}`,
    });
    expect(slotsRes.statusCode).toBe(404);

    await expect(
      bookingService.holdSlot(doctor.id, slotIso, patient.id),
    ).rejects.toThrow(ForbiddenException);

    // Re-activate user but mark unverified
    await ctx.prisma.user.update({
      where: { id: docUser.id },
      data: { isActive: true },
    });
    await ctx.prisma.doctor.update({
      where: { id: doctor.id },
      data: { isVerified: false },
    });

    const unverifiedSlotsRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/doctors/${doctor.id}/slots?date=${dateStr}`,
    });
    expect(unverifiedSlotsRes.statusCode).toBe(404);
  });

  it('B16: getMyAppointments filters fromDate/toDate in clinic IST day bounds instead of UTC', async () => {
    const { doctor } = await seedVerifiedDoctor(ctx.prisma);
    const patient = await seedPatient(ctx.prisma, 'b16-patient');

    // 2026-12-05 01:30 IST === 2026-12-04T20:00:00.000Z (previous UTC calendar day!)
    const earlyMorningIst = istWallClockToUtcDate('2026-12-05', '01:30');
    await ctx.prisma.appointment.create({
      data: {
        bookingRef: `MB-B16-${Date.now().toString(36)}`,
        doctorId: doctor.id,
        patientId: patient.id,
        slotTime: earlyMorningIst,
        status: 'CONFIRMED',
      },
    });

    const dec05 = await bookingService.getMyAppointments(patient.id, 'PATIENT', {
      fromDate: '2026-12-05',
      toDate: '2026-12-05',
      limit: 10,
    });
    expect(dec05.items).toHaveLength(1);

    const dec04 = await bookingService.getMyAppointments(patient.id, 'PATIENT', {
      fromDate: '2026-12-04',
      toDate: '2026-12-04',
      limit: 10,
    });
    expect(dec04.items).toHaveLength(0);

    // Dynamic IANA timezone test (no hardcoded +05:30): America/New_York winter EST = UTC-5
    const nyBounds = getIstDayBoundsUtc('2026-12-05', 'America/New_York');
    expect(nyBounds.start.toISOString()).toBe('2026-12-05T05:00:00.000Z');
  });

  it('B17 & B18: atomic global daily bookingRef without cross-doctor collisions & waits for in-flight idempotency', async () => {
    const doctors = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        seedVerifiedDoctor(ctx.prisma, { email: `b17-doc-${i}@medibook.test` }),
      ),
    );
    const slotTarget = new Date('2026-12-10T10:00:00.000+05:30');

    // 25 parallel generateDailyReferenceToken calls across 5 doctors -> unique MB-20261210-001..025
    const refs = await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        bookingService.generateDailyReferenceToken(
          doctors[i % doctors.length].doctor.id,
          slotTarget,
        ),
      ),
    );
    expect(new Set(refs).size).toBe(25);
    expect(refs.every((r) => /^MB-20261210-\d{3,}$/.test(r))).toBe(true);

    // B18: In-flight idempotency key waits cleanly instead of failing 409 after 150ms
    const patient = await seedPatient(ctx.prisma, 'b18-patient');
    const futureDate = new Date(Date.now() + 96 * 60 * 60 * 1000);
    const dateStr = getIstDateString(futureDate);
    const slotIso = istWallClockToUtcDate(dateStr, '14:00').toISOString();

    const idemKey = `idem_b18_${randomUUID()}`;
    const fullIdemKey = `book:${patient.id}:${idemKey}`;
    // Pre-create appointment and simulate an active Redis idempotency lock completing 300ms later
    const createdAppt = await ctx.prisma.appointment.create({
      data: {
        bookingRef: 'MB-20261211-001',
        doctorId: doctors[0].doctor.id,
        patientId: patient.id,
        slotTime: new Date(slotIso),
        status: 'PENDING_PAYMENT',
        consultationMode: 'VIDEO',
      },
    });
    await ctx.redisClient.set(`idem:lock:${fullIdemKey}`, '1', 'EX', 15, 'NX');

    setTimeout(async () => {
      await ctx.redisClient.set(`idem:${fullIdemKey}`, JSON.stringify(createdAppt), 'EX', 60);
      await ctx.redisClient.del(`idem:lock:${fullIdemKey}`);
    }, 300);

    const replay = await bookingService.bookAppointment(
      doctors[0].doctor.id,
      slotIso,
      patient.id,
      'unused-hold-on-replay-after-wait',
      'VIDEO',
      undefined,
      idemKey,
    );
    expect(replay.id).toBe(createdAppt.id);

    // Concurrent SKIP LOCKED check: 2 parallel frees on 2 open slots with 1 date-wide WAITING entry -> offered at most once
    const flexPatient = await seedPatient(ctx.prisma, 'wl-flex');
    const flexDateStr = getIstDateString(new Date(Date.now() + 120 * 60 * 60 * 1000));
    await waitlistService.joinWaitlist(doctors[1].doctor.id, flexPatient.id, flexDateStr);
    const flexSlotA = istWallClockToUtcDate(flexDateStr, '10:00').toISOString();
    const flexSlotB = istWallClockToUtcDate(flexDateStr, '11:00').toISOString();

    const [flexOfferA, flexOfferB] = await Promise.all([
      waitlistService.offerCancelledSlotToNext(doctors[1].doctor.id, flexSlotA),
      waitlistService.offerCancelledSlotToNext(doctors[1].doctor.id, flexSlotB),
    ]);
    const wonOffers = [flexOfferA, flexOfferB].filter(Boolean);
    expect(wonOffers).toHaveLength(1);
  });
});
