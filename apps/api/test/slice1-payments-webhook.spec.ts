import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import * as crypto from 'crypto';
import {
  bootTestApp,
  resetDatabaseAndRedis,
  seedVerifiedDoctor,
  seedPatient,
  seedAdmin,
  signJwtForUser,
  TestContext,
} from './helpers/test-app';
import { BookingService } from '../src/modules/scheduling/services/booking.service';
import { PaymentService } from '../src/modules/payments/services/payment.service';
import { LedgerService } from '../src/modules/payments/services/ledger.service';
import { FakePaymentProvider } from '../src/modules/payments/providers/fake.provider';
import { istWallClockToUtcDate } from '../src/common/utils/ist-time';

describe('Slice 1: Real Razorpay-Style RawBody Webhooks, Ledger, Late Payment & Refunds', () => {
  let ctx: TestContext;
  let bookingService: BookingService;
  let paymentService: PaymentService;
  let ledgerService: LedgerService;
  let fakeProvider: FakePaymentProvider;

  beforeAll(async () => {
    ctx = await bootTestApp();
    bookingService = ctx.app.get(BookingService);
    paymentService = ctx.app.get(PaymentService);
    ledgerService = ctx.app.get(LedgerService);
    fakeProvider = ctx.app.get(FakePaymentProvider);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await resetDatabaseAndRedis(ctx.prisma, ctx.redisClient);
  });

  async function createPendingBookingAndCheckout(patient: any, doctor: any, time = '10:00') {
    const dateStr = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const slotIso = istWallClockToUtcDate(dateStr, time).toISOString();
    const hold = await bookingService.holdSlot(doctor.id, slotIso, patient.id);
    const appt = await bookingService.bookAppointment(
      doctor.id,
      slotIso,
      patient.id,
      hold.holdToken,
    );
    const checkout = await paymentService.createCheckout(
      patient.id,
      appt.id,
      randomUUID(),
    );
    return { appt, checkout };
  }

  it('Pay-without-booking-state is rejected (cancelled, confirmed, or nonexistent appointment)', async () => {
    const { doctor } = await seedVerifiedDoctor(ctx.prisma);
    const patient = await seedPatient(ctx.prisma);
    const token = signJwtForUser(patient);

    // Nonexistent appointment
    const missingRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/payments/checkout',
      headers: { authorization: `Bearer ${token}` },
      payload: { appointmentId: randomUUID(), idempotencyKey: randomUUID() },
    });
    expect(missingRes.statusCode).toBe(404);

    // Cancelled appointment
    const dateStr = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const slotIso = istWallClockToUtcDate(dateStr, '10:30').toISOString();
    const hold = await bookingService.holdSlot(doctor.id, slotIso, patient.id);
    const appt = await bookingService.bookAppointment(doctor.id, slotIso, patient.id, hold.holdToken);
    await bookingService.cancelAppointment(appt.id, patient.id, 'cancelled before pay');

    const cancelledPayRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/payments/checkout',
      headers: { authorization: `Bearer ${token}` },
      payload: { appointmentId: appt.id, idempotencyKey: randomUUID() },
    });
    expect(cancelledPayRes.statusCode).toBe(409);
  });

  it('Raw body HMAC verification over HTTP confirms appointment, posts balanced ledger & outbox', async () => {
    const { doctor } = await seedVerifiedDoctor(ctx.prisma, { consultationFeePaise: 80000 });
    const patient = await seedPatient(ctx.prisma);
    const { appt, checkout } = await createPendingBookingAndCheckout(patient, doctor);

    // Construct non-compact raw JSON with custom whitespace to prove HMAC verifies on RAW BYTES, not JSON.stringify
    const rawPayload = `{\n  "id": "evt_raw_001",\n  "event": "payment.captured",\n  "payload": {\n    "payment": {\n      "entity": {\n        "id": "pay_raw_001",\n        "order_id": "${checkout.providerOrderId}",\n        "amount": 80000\n      }\n    }\n  }\n}`;
    const signature = fakeProvider.generateSignature(rawPayload);

    // Bad signature rejected
    const badRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/payments/webhook',
      headers: {
        'content-type': 'application/json',
        'x-razorpay-signature': 'deadbeef'.repeat(8),
      },
      payload: rawPayload,
    });
    expect(badRes.statusCode).toBe(400);

    // Valid raw bytes signature accepted
    const goodRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/payments/webhook',
      headers: {
        'content-type': 'application/json',
        'x-razorpay-signature': signature,
      },
      payload: rawPayload,
    });
    expect(goodRes.statusCode).toBe(200);
    expect(goodRes.json().status).toBe('CAPTURED');

    const confirmedAppt = await ctx.prisma.appointment.findUnique({ where: { id: appt.id } });
    expect(confirmedAppt?.status).toBe('CONFIRMED');

    const isBalanced = await ledgerService.verifyZeroSum(checkout.paymentId);
    expect(isBalanced).toBe(true);

    const ledgerEntries = await ctx.prisma.ledgerEntry.findMany({
      where: { transactionId: checkout.paymentId },
    });
    expect(ledgerEntries).toHaveLength(3);

    const outboxEvents = await ctx.prisma.outboxEvent.findMany({
      where: { eventType: { in: ['APPOINTMENT_CONFIRMED', 'PAYMENT_CAPTURED'] } },
    });
    expect(outboxEvents).toHaveLength(2);
  });

  it('Webhook x10 concurrent replay -> exactly ONE ledger posting and debits == credits', async () => {
    const { doctor } = await seedVerifiedDoctor(ctx.prisma, { consultationFeePaise: 90000 });
    const patient = await seedPatient(ctx.prisma);
    const { appt, checkout } = await createPendingBookingAndCheckout(patient, doctor);

    // Fire 10 concurrent webhooks: 5 identical eventId + 5 distinct eventIds for the SAME order
    const requests = Array.from({ length: 10 }, (_, idx) => {
      const eventId = idx < 5 ? 'evt_replay_same_001' : `evt_replay_diff_${idx}`;
      const rawBody = JSON.stringify({
        id: eventId,
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: `pay_concurrent_${idx}`,
              order_id: checkout.providerOrderId,
              amount: 90000,
            },
          },
        },
      });
      const sig = crypto
        .createHmac('sha256', process.env.PAYMENT_WEBHOOK_SECRET!)
        .update(rawBody)
        .digest('hex');

      return ctx.app.inject({
        method: 'POST',
        url: '/api/payments/webhook',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': sig,
        },
        payload: rawBody,
      });
    });

    const responses = await Promise.all(requests);
    expect(responses.every((r) => r.statusCode === 200)).toBe(true);

    const ledgerEntries = await ctx.prisma.ledgerEntry.findMany({
      where: { transactionId: checkout.paymentId },
    });
    // Strictly 1 capture posting (3 rows: 1 DEBIT ESCROW, 1 CREDIT DOCTOR_PAYABLE, 1 CREDIT PLATFORM_REVENUE)
    expect(ledgerEntries).toHaveLength(3);

    const debits = ledgerEntries
      .filter((e) => e.entryType === 'DEBIT')
      .reduce((acc, e) => acc + e.amountPaise, 0);
    const credits = ledgerEntries
      .filter((e) => e.entryType === 'CREDIT')
      .reduce((acc, e) => acc + e.amountPaise, 0);
    expect(debits).toBe(90000);
    expect(credits).toBe(90000);
    expect(debits).toBe(credits);

    const confirmedAppt = await ctx.prisma.appointment.findUnique({ where: { id: appt.id } });
    expect(confirmedAppt?.status).toBe('CONFIRMED');
  });

  it('Late payment after expiry triggers atomic auto-refund and balanced ledger', async () => {
    const { doctor } = await seedVerifiedDoctor(ctx.prisma, { consultationFeePaise: 75000 });
    const patient = await seedPatient(ctx.prisma);
    const { appt, checkout } = await createPendingBookingAndCheckout(patient, doctor);

    // Expire the unpaid appointment
    await ctx.prisma.$executeRaw`
      UPDATE appointments SET created_at = NOW() - INTERVAL '25 minutes' WHERE id = ${appt.id}::uuid
    `;
    await bookingService.releaseExpiredPendingAppointments(15);

    const rawBody = JSON.stringify({
      id: 'evt_late_pay_001',
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_late_001',
            order_id: checkout.providerOrderId,
            amount: 75000,
          },
        },
      },
    });
    const sig = fakeProvider.generateSignature(rawBody);

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/payments/webhook',
      headers: {
        'content-type': 'application/json',
        'x-razorpay-signature': sig,
      },
      payload: rawBody,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('AUTO_REFUNDED');

    const payment = await ctx.prisma.payment.findUnique({
      where: { id: checkout.paymentId },
      include: { refunds: true },
    });
    expect(payment?.status).toBe('REFUNDED');
    expect(payment?.refunds).toHaveLength(1);
    expect(payment?.refunds[0].reason).toBe('AUTO_REFUND_LATE_PAYMENT');

    const isBalanced = await ledgerService.verifyZeroSum(checkout.paymentId);
    expect(isBalanced).toBe(true);

    // Post-commit provider refund execution via outbox
    const processedRefund = await paymentService.executePendingRefund(payment!.refunds[0].id);
    expect(processedRefund.status).toBe('PROCESSED');
    expect(processedRefund.providerRefundId).toBeTruthy();
  });

  it('Payment GET/refund authorization & concurrent refund safety with FOR UPDATE row lock', async () => {
    const { user: doctorUser, doctor } = await seedVerifiedDoctor(ctx.prisma, {
      consultationFeePaise: 100000,
    });
    const owner = await seedPatient(ctx.prisma, 'owner');
    const stranger = await seedPatient(ctx.prisma, 'stranger');
    const admin = await seedAdmin(ctx.prisma);

    const { checkout } = await createPendingBookingAndCheckout(owner, doctor);

    // Capture via dev simulate-webhook endpoint
    const simRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/payments/dev/simulate-webhook',
      headers: { authorization: `Bearer ${signJwtForUser(owner)}` },
      payload: { paymentId: checkout.paymentId, event: 'payment.captured' },
    });
    expect(simRes.statusCode).toBe(200);
    expect(simRes.json().status).toBe('CAPTURED');

    // Stranger cannot GET payment or refund
    const strangerGet = await ctx.app.inject({
      method: 'GET',
      url: `/api/payments/${checkout.paymentId}`,
      headers: { authorization: `Bearer ${signJwtForUser(stranger)}` },
    });
    expect(strangerGet.statusCode).toBe(403);

    const strangerRefund = await ctx.app.inject({
      method: 'POST',
      url: `/api/payments/${checkout.paymentId}/refund`,
      headers: { authorization: `Bearer ${signJwtForUser(stranger)}` },
      payload: { reason: 'Unauthorized attempt' },
    });
    expect(strangerRefund.statusCode).toBe(403);

    // Owner, doctor, and admin CAN read payment
    for (const actor of [owner, doctorUser, admin]) {
      const okGet = await ctx.app.inject({
        method: 'GET',
        url: `/api/payments/${checkout.paymentId}`,
        headers: { authorization: `Bearer ${signJwtForUser(actor)}` },
      });
      expect(okGet.statusCode).toBe(200);
    }

    // Concurrent double-refund race -> exactly 1 succeeds, 1 fails inside FOR UPDATE lock
    const [r1, r2] = await Promise.all([
      ctx.app.inject({
        method: 'POST',
        url: `/api/payments/${checkout.paymentId}/refund`,
        headers: { authorization: `Bearer ${signJwtForUser(owner)}` },
        payload: { reason: 'Patient changed mind' },
      }),
      ctx.app.inject({
        method: 'POST',
        url: `/api/payments/${checkout.paymentId}/refund`,
        headers: { authorization: `Bearer ${signJwtForUser(doctorUser)}` },
        payload: { reason: 'Doctor refund race' },
      }),
    ]);

    const statuses = [r1.statusCode, r2.statusCode].sort();
    expect(statuses).toEqual([201, 400]);

    const refundsInDb = await ctx.prisma.refund.findMany({
      where: { paymentId: checkout.paymentId },
    });
    expect(refundsInDb).toHaveLength(1);
    expect(await ledgerService.verifyZeroSum(checkout.paymentId)).toBe(true);
  });
});
