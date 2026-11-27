import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createHmac, randomUUID } from 'crypto';
import {
  bootTestApp,
  resetDatabaseAndRedis,
  seedPatient,
  seedVerifiedDoctor,
  signJwtForUser,
  TestContext,
} from './helpers/test-app';
import { PaymentService } from '../src/modules/payments/services/payment.service';
import { RazorpayProvider } from '../src/modules/payments/providers/razorpay.provider';
import { getIstDateString } from '../src/common/utils/ist-time';

function signWebhook(
  body: Buffer,
  secret = process.env.PAYMENT_WEBHOOK_SECRET || 'dev_webhook_secret_key_for_hmac_verification',
) {
  return createHmac('sha256', secret).update(body).digest('hex');
}

describe('Workstream 1: Payments Integrity (B1, B6, B7, B11, B12, B13)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await bootTestApp();
  });

  beforeEach(async () => {
    await resetDatabaseAndRedis(ctx.prisma, ctx.redisClient);
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  async function seedAppointment(opts: {
    status?: 'PENDING_PAYMENT' | 'CONFIRMED';
    hoursAhead?: number;
    feePaise?: number;
  } = {}) {
    const { doctor, user: docUser } = await seedVerifiedDoctor(ctx.prisma, {
      consultationFeePaise: opts.feePaise ?? 80000,
    });
    const patient = await seedPatient(ctx.prisma, `ws1_${randomUUID().slice(0, 6)}@medibook.test`);
    const slotTime = new Date(Date.now() + (opts.hoursAhead ?? 48) * 3600_000);
    const appt = await ctx.prisma.appointment.create({
      data: {
        patientId: patient.id,
        doctorId: doctor.id,
        slotTime,
        status: opts.status ?? 'PENDING_PAYMENT',
        bookingRef: `MB-WS1-${randomUUID().slice(0, 6)}`,
      },
    });
    const session = await ctx.prisma.consultationSession.create({
      data: {
        appointmentId: appt.id,
        roomName: `consult-${appt.id}`,
        status: 'SCHEDULED',
      },
    });
    return {
      doctor,
      docUser,
      patient,
      appt,
      session,
      token: signJwtForUser(patient),
      docToken: signJwtForUser(docUser),
    };
  }

  it('B1: ignores non-capture webhook events, looks up omitted amount, and uses deterministic fallback event id', async () => {
    const { appt, token } = await seedAppointment({ feePaise: 65000 });
    const checkoutRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/payments/checkout',
      headers: { authorization: `Bearer ${token}` },
      payload: { appointmentId: appt.id, idempotencyKey: randomUUID() },
    });
    expect(checkoutRes.statusCode).toBe(201);
    const { providerOrderId, paymentId } = checkoutRes.json();

    // 1. payment.authorized must be IGNORED and never confirm appointment
    const authPayload = Buffer.from(
      JSON.stringify({
        event: 'payment.authorized',
        payload: {
          payment: {
            entity: {
              id: 'pay_auth_only_1',
              order_id: providerOrderId,
              amount: 65000,
              currency: 'INR',
            },
          },
        },
      }),
      'utf8',
    );
    const authRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/payments/webhook',
      headers: {
        'content-type': 'application/json',
        'x-razorpay-signature': signWebhook(authPayload),
      },
      payload: authPayload,
    });
    expect(authRes.statusCode).toBe(200);
    expect(authRes.json().status).toBe('IGNORED');

    // Replay without explicit id/header must still dedup deterministically
    const authReplay = await ctx.app.inject({
      method: 'POST',
      url: '/api/payments/webhook',
      headers: {
        'content-type': 'application/json',
        'x-razorpay-signature': signWebhook(authPayload),
      },
      payload: authPayload,
    });
    expect(authReplay.statusCode).toBe(200);
    expect(authReplay.json().status).toBe('DUPLICATE_NOOP');

    const apptStillPending = await ctx.prisma.appointment.findUnique({ where: { id: appt.id } });
    expect(apptStillPending?.status).toBe('PENDING_PAYMENT');

    // 2. payment.captured omitting amountPaise must look up amount from payment row rather than defaulting to 0
    const capNoAmtPayload = Buffer.from(
      JSON.stringify({
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: 'pay_no_amt_1',
              order_id: providerOrderId,
              currency: 'INR',
            },
          },
        },
      }),
      'utf8',
    );
    const capRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/payments/webhook',
      headers: {
        'content-type': 'application/json',
        'x-razorpay-signature': signWebhook(capNoAmtPayload),
      },
      payload: capNoAmtPayload,
    });
    expect(capRes.statusCode).toBe(200);
    expect(capRes.json().status).toBe('CAPTURED');

    const paid = await ctx.prisma.payment.findUnique({ where: { id: paymentId } });
    expect(paid?.status).toBe('CAPTURED');
  });

  it('B6: claims refund IN_FLIGHT atomically to prevent concurrent double refunds and sends X-Refund-Idempotency + timeout', async () => {
    const paymentService = ctx.app.get(PaymentService);
    const { appt } = await seedAppointment({ status: 'CONFIRMED', feePaise: 50000 });
    const payment = await ctx.prisma.payment.create({
      data: {
        appointmentId: appt.id,
        provider: 'FAKE',
        providerOrderId: `ord_${randomUUID().slice(0, 8)}`,
        providerPaymentId: `pay_${randomUUID().slice(0, 8)}`,
        amountPaise: 50000,
        status: 'REFUNDED',
        idempotencyKey: randomUUID(),
      },
    });
    const refund = await ctx.prisma.refund.create({
      data: {
        paymentId: payment.id,
        amountPaise: 50000,
        reason: 'Concurrent refund guard',
        status: 'PENDING',
      },
    });

    let calls = 0;
    const provider = (paymentService as any).provider;
    vi.spyOn(provider, 'issueRefund').mockImplementation(async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 80));
      return { providerRefundId: `rfnd_once_${refund.id}`, amountPaise: 50000, status: 'PROCESSED' as const };
    });

    await Promise.allSettled([
      paymentService.executePendingRefund(refund.id),
      paymentService.executePendingRefund(refund.id),
    ]);
    expect(calls).toBe(1);

    // RazorpayProvider sends X-Refund-Idempotency and AbortSignal
    const rzp = new RazorpayProvider();
    (rzp as any).keyId = 'rzp_test_key';
    (rzp as any).keySecret = 'rzp_test_sec';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'rfnd_rzp_1', amount: 50000, status: 'processed' }),
    } as Response);

    await rzp.issueRefund({
      refundId: refund.id,
      paymentId: payment.id,
      providerPaymentId: 'pay_rzp_1',
      amountPaise: 50000,
      reason: 'Cancel',
    });

    const fetchCallOpts = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    const hdrs = fetchCallOpts?.headers as Record<string, string>;
    expect(hdrs['X-Refund-Idempotency']).toBe(refund.id);
    expect(fetchCallOpts?.signal).toBeTruthy();
  });

  it('B7: blocks patient cancelAppointment after slot time while allowing ADMIN override', async () => {
    const { appt, token } = await seedAppointment({ status: 'CONFIRMED', hoursAhead: -2, feePaise: 80000 });
    await ctx.prisma.payment.create({
      data: {
        appointmentId: appt.id,
        provider: 'FAKE',
        providerOrderId: `ord_${randomUUID().slice(0, 8)}`,
        providerPaymentId: `pay_${randomUUID().slice(0, 8)}`,
        amountPaise: 80000,
        status: 'CAPTURED',
        idempotencyKey: randomUUID(),
      },
    });

    const pastCancel = await ctx.app.inject({
      method: 'POST',
      url: `/api/appointments/${appt.id}/cancel`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: 'Trying late cancel for 50% refund' },
    });
    expect(pastCancel.statusCode).toBe(400);

    const admin = await ctx.prisma.user.create({
      data: {
        email: `adm_${randomUUID().slice(0, 6)}@medibook.test`,
        passwordHash: 'hash',
        name: 'Admin',
        role: 'ADMIN',
      },
    });
    const adminCancel = await ctx.app.inject({
      method: 'POST',
      url: `/api/appointments/${appt.id}/cancel`,
      headers: { authorization: `Bearer ${signJwtForUser(admin)}` },
      payload: { reason: 'Admin past-slot override' },
    });
    expect(adminCancel.statusCode).toBe(201);
  });

  it('B11: cancelAppointment and applyLeave fail pending payments cleanly', async () => {
    // 1. Patient cancels PENDING_PAYMENT appointment -> INITIATED payment becomes FAILED
    const p1 = await seedAppointment({ status: 'PENDING_PAYMENT', hoursAhead: 48 });
    const c1 = await ctx.app.inject({
      method: 'POST',
      url: '/api/payments/checkout',
      headers: { authorization: `Bearer ${p1.token}` },
      payload: { appointmentId: p1.appt.id, idempotencyKey: randomUUID() },
    });
    expect(c1.statusCode).toBe(201);
    const pay1Id = c1.json().paymentId;

    const cancelRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/appointments/${p1.appt.id}/cancel`,
      headers: { authorization: `Bearer ${p1.token}` },
      payload: { reason: 'Changed mind before pay' },
    });
    expect(cancelRes.statusCode).toBe(201);

    const pay1After = await ctx.prisma.payment.findUnique({ where: { id: pay1Id } });
    expect(pay1After?.status).toBe('FAILED');

    // 2. Doctor applies leave covering PENDING_PAYMENT booking -> payment becomes FAILED
    const p2 = await seedAppointment({ status: 'PENDING_PAYMENT', hoursAhead: 72 });
    const c2 = await ctx.app.inject({
      method: 'POST',
      url: '/api/payments/checkout',
      headers: { authorization: `Bearer ${p2.token}` },
      payload: { appointmentId: p2.appt.id, idempotencyKey: randomUUID() },
    });
    expect(c2.statusCode).toBe(201);
    const leaveDate = getIstDateString(p2.appt.slotTime);

    const leaveRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/doctors/${p2.doctor.id}/leaves`,
      headers: { authorization: `Bearer ${p2.docToken}` },
      payload: { startDate: leaveDate, endDate: leaveDate, reason: 'Conference' },
    });
    expect(leaveRes.statusCode).toBe(201);

    const pay2After = await ctx.prisma.payment.findUnique({ where: { id: c2.json().paymentId } });
    expect(pay2After?.status).toBe('FAILED');
  });

  it('B12: createCheckout binds key to appointmentId, returns live status on replay, and preserves failed idempotencyKey', async () => {
    const a1 = await seedAppointment({ status: 'PENDING_PAYMENT', feePaise: 50000 });
    const a2 = await seedAppointment({ status: 'PENDING_PAYMENT', feePaise: 50000 });
    const sharedKey = randomUUID();

    const first = await ctx.app.inject({
      method: 'POST',
      url: '/api/payments/checkout',
      headers: { authorization: `Bearer ${a1.token}` },
      payload: { appointmentId: a1.appt.id, idempotencyKey: sharedKey },
    });
    expect(first.statusCode).toBe(201);

    // Same idempotencyKey on different appointmentId must be rejected cleanly
    const wrongAppt = await ctx.app.inject({
      method: 'POST',
      url: '/api/payments/checkout',
      headers: { authorization: `Bearer ${a2.token}` },
      payload: { appointmentId: a2.appt.id, idempotencyKey: sharedKey },
    });
    expect(wrongAppt.statusCode).toBe(409);

    // Fail payment via webhook -> replaying same key must return LIVE FAILED status, not stale Redis INITIATED
    const failBody = Buffer.from(
      JSON.stringify({
        id: `evt_b12_fail_${randomUUID().slice(0, 8)}`,
        event: 'payment.failed',
        payload: {
          payment: {
            entity: {
              id: 'pay_b12_fail',
              order_id: first.json().providerOrderId,
              amount: 50000,
              currency: 'INR',
            },
          },
        },
      }),
      'utf8',
    );
    await ctx.app.inject({
      method: 'POST',
      url: '/api/payments/webhook',
      headers: { 'content-type': 'application/json', 'x-razorpay-signature': signWebhook(failBody) },
      payload: failBody,
    });

    const replayAfterFail = await ctx.app.inject({
      method: 'POST',
      url: '/api/payments/checkout',
      headers: { authorization: `Bearer ${a1.token}` },
      payload: { appointmentId: a1.appt.id, idempotencyKey: sharedKey },
    });
    expect(replayAfterFail.statusCode).toBe(201);
    expect(replayAfterFail.json().status).toBe('FAILED');

    // Retry with new key preserves ability to replay first key cleanly too
    const retryKey = randomUUID();
    const retryRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/payments/checkout',
      headers: { authorization: `Bearer ${a1.token}` },
      payload: { appointmentId: a1.appt.id, idempotencyKey: retryKey },
    });
    expect(retryRes.statusCode).toBe(201);
    expect(retryRes.json().status).toBe('INITIATED');

    const replayOriginalKey = await ctx.app.inject({
      method: 'POST',
      url: '/api/payments/checkout',
      headers: { authorization: `Bearer ${a1.token}` },
      payload: { appointmentId: a1.appt.id, idempotencyKey: sharedKey },
    });
    expect(replayOriginalKey.statusCode).toBe(201);
    expect(replayOriginalKey.json().paymentId).toBe(first.json().paymentId);
  });

  it('B13: refundPayment emits AppointmentSlotFreed & AppointmentCancelled, clears cache:next_slot, and closes ConsultationSession', async () => {
    const { doctor, appt, token } = await seedAppointment({ status: 'CONFIRMED', hoursAhead: 48, feePaise: 90000 });
    const payment = await ctx.prisma.payment.create({
      data: {
        appointmentId: appt.id,
        provider: 'FAKE',
        providerOrderId: `ord_${randomUUID().slice(0, 8)}`,
        providerPaymentId: `pay_${randomUUID().slice(0, 8)}`,
        amountPaise: 90000,
        status: 'CAPTURED',
        idempotencyKey: randomUUID(),
      },
    });
    await ctx.redisClient.set(`cache:next_slot:${doctor.id}`, 'stale_slot_iso');

    const refundRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/payments/${payment.id}/refund`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: 'Manual refund requested' },
    });
    expect(refundRes.statusCode).toBe(201);

    const freedOutbox = await ctx.prisma.outboxEvent.findFirst({
      where: { aggregateId: appt.id, eventType: 'AppointmentSlotFreed' },
    });
    const cancelledOutbox = await ctx.prisma.outboxEvent.findFirst({
      where: { aggregateId: appt.id, eventType: 'AppointmentCancelled' },
    });
    expect(freedOutbox).toBeTruthy();
    expect(cancelledOutbox).toBeTruthy();

    const cachedNextSlot = await ctx.redisClient.get(`cache:next_slot:${doctor.id}`);
    expect(cachedNextSlot).toBeNull();

    const closedSession = await ctx.prisma.consultationSession.findUnique({
      where: { appointmentId: appt.id },
    });
    expect(closedSession?.status).toBe('ENDED');
    expect(closedSession?.endedAt).toBeTruthy();
  });
});
