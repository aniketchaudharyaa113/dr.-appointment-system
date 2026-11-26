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
import { EnvSchema } from '../src/common/config/env.schema';

function signFakeWebhook(body: Buffer, secret = process.env.PAYMENT_WEBHOOK_SECRET || 'dev_webhook_secret_key_for_hmac_verification') {
  return createHmac('sha256', secret).update(body).digest('hex');
}

describe('P0-6..P0-10: Payment Webhook, Reconciliation, Retry & Config Hardening', () => {
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

  async function seedPendingBooking(feePaise = 75000) {
    const { doctor } = await seedVerifiedDoctor(ctx.prisma, {
      consultationFeePaise: feePaise,
    });
    const patient = await seedPatient(
      ctx.prisma,
      `p_${randomUUID().slice(0, 6)}@medibook.test`,
    );
    const slotTime = new Date(Date.now() + 48 * 3600_000);
    const appt = await ctx.prisma.appointment.create({
      data: {
        patientId: patient.id,
        doctorId: doctor.id,
        slotTime,
        status: 'PENDING_PAYMENT',
        bookingRef: `MB-PAY-${randomUUID().slice(0, 6)}`,
      },
    });
    const token = signJwtForUser(patient);
    return { doctor, patient, appt, token };
  }

  it('P0-6: re-processes a webhook whose payment_events row was left PENDING after a crash', async () => {
    const { appt, token } = await seedPendingBooking(60000);

    const checkoutRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/payments/checkout',
      headers: { authorization: `Bearer ${token}` },
      payload: { appointmentId: appt.id, idempotencyKey: randomUUID() },
    });
    expect(checkoutRes.statusCode).toBe(201);
    const { providerOrderId, paymentId } = checkoutRes.json();

    const eventId = `evt_crash_${randomUUID().slice(0, 8)}`;
    const payloadObj = {
      id: eventId,
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: `pay_${randomUUID().slice(0, 8)}`,
            order_id: providerOrderId,
            amount: 60000,
            currency: 'INR',
          },
        },
      },
    };
    const rawBody = Buffer.from(JSON.stringify(payloadObj), 'utf8');
    const sig = signFakeWebhook(rawBody);

    // Simulate a prior crash that left payment_events row in PENDING
    await ctx.prisma.paymentEvent.create({
      data: {
        providerEventId: eventId,
        eventType: 'payment.captured',
        payload: payloadObj,
        status: 'PENDING',
      },
    });

    const retryRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/payments/webhook',
      headers: {
        'content-type': 'application/json',
        'x-razorpay-signature': sig,
      },
      payload: rawBody,
    });
    expect(retryRes.statusCode).toBe(200);
    expect(retryRes.json().status).toBe('CAPTURED');

    const updatedAppt = await ctx.prisma.appointment.findUnique({ where: { id: appt.id } });
    const updatedPay = await ctx.prisma.payment.findUnique({ where: { id: paymentId } });
    const updatedEvt = await ctx.prisma.paymentEvent.findUnique({ where: { providerEventId: eventId } });
    expect(updatedAppt?.status).toBe('CONFIRMED');
    expect(updatedPay?.status).toBe('CAPTURED');
    expect(updatedEvt?.status).toBe('PROCESSED');

    // Subsequent duplicate after PROCESSED is a no-op
    const dupRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/payments/webhook',
      headers: {
        'content-type': 'application/json',
        'x-razorpay-signature': sig,
      },
      payload: rawBody,
    });
    expect(dupRes.statusCode).toBe(200);
    expect(dupRes.json().status).toBe('DUPLICATE_NOOP');
  });

  it('P0-7: flags amount/currency mismatch for manual review, deduplicates via x-razorpay-event-id, and fetches Razorpay order payments', async () => {
    const { appt, token } = await seedPendingBooking(80000);
    const checkoutRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/payments/checkout',
      headers: { authorization: `Bearer ${token}` },
      payload: { appointmentId: appt.id, idempotencyKey: randomUUID() },
    });
    const { providerOrderId } = checkoutRes.json();

    // (a) Amount mismatch -> MANUAL_REVIEW_REQUIRED, appointment stays PENDING_PAYMENT
    const mismatchPayload = {
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: `pay_bad_${randomUUID().slice(0, 6)}`,
            order_id: providerOrderId,
            amount: 100, // wrong amount
            currency: 'INR',
          },
        },
      },
    };
    const mismatchRaw = Buffer.from(JSON.stringify(mismatchPayload), 'utf8');
    const headerEvtId = `rzp_evt_${randomUUID().slice(0, 8)}`;

    const mismatchRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/payments/webhook',
      headers: {
        'content-type': 'application/json',
        'x-razorpay-signature': signFakeWebhook(mismatchRaw),
        'x-razorpay-event-id': headerEvtId,
      },
      payload: mismatchRaw,
    });
    expect(mismatchRes.statusCode).toBe(200);
    expect(mismatchRes.json().status).toBe('MANUAL_REVIEW_REQUIRED');

    const apptAfterMismatch = await ctx.prisma.appointment.findUnique({ where: { id: appt.id } });
    expect(apptAfterMismatch?.status).toBe('PENDING_PAYMENT');

    // (b) Same x-razorpay-event-id header triggers DUPLICATE_NOOP even though body had no id field
    const dupHeaderRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/payments/webhook',
      headers: {
        'content-type': 'application/json',
        'x-razorpay-signature': signFakeWebhook(mismatchRaw),
        'x-razorpay-event-id': headerEvtId,
      },
      payload: mismatchRaw,
    });
    expect(dupHeaderRes.statusCode).toBe(200);
    expect(dupHeaderRes.json().status).toBe('DUPLICATE_NOOP');

    // (c) RazorpayProvider.fetchPaymentStatus queries GET /v1/orders/:id/payments
    const rzp = new RazorpayProvider();
    (rzp as any).keyId = 'rzp_test_key';
    (rzp as any).keySecret = 'rzp_test_secret';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [
          { id: 'pay_failed_1', status: 'failed' },
          { id: 'pay_cap_2', status: 'captured' },
        ],
      }),
    } as Response);
    const status = await rzp.fetchPaymentStatus('order_rzp_123');
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.razorpay.com/v1/orders/order_rzp_123/payments',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(status).toEqual({ status: 'CAPTURED', providerPaymentId: 'pay_cap_2' });
  });

  it('P0-8: reconcileStuckPayments emits APPOINTMENT_CONFIRMED on valid capture and auto-refunds if appointment was CANCELLED', async () => {
    const paymentService = ctx.app.get(PaymentService);
    const { appt: validAppt, token: t1 } = await seedPendingBooking(50000);
    const { appt: cancelledAppt, token: t2 } = await seedPendingBooking(50000);

    const c1 = (
      await ctx.app.inject({
        method: 'POST',
        url: '/api/payments/checkout',
        headers: { authorization: `Bearer ${t1}` },
        payload: { appointmentId: validAppt.id, idempotencyKey: randomUUID() },
      })
    ).json();
    const c2 = (
      await ctx.app.inject({
        method: 'POST',
        url: '/api/payments/checkout',
        headers: { authorization: `Bearer ${t2}` },
        payload: { appointmentId: cancelledAppt.id, idempotencyKey: randomUUID() },
      })
    ).json();

    // Age both payments > 15m and cancel the second appointment
    const oldDate = new Date(Date.now() - 20 * 60_000);
    await ctx.prisma.payment.updateMany({
      where: { id: { in: [c1.paymentId, c2.paymentId] } },
      data: { createdAt: oldDate },
    });
    await ctx.prisma.appointment.update({
      where: { id: cancelledAppt.id },
      data: { status: 'CANCELLED' },
    });

    const provider = (paymentService as any).provider;
    vi.spyOn(provider, 'fetchPaymentStatus').mockImplementation((async (orderId: string) => ({
      status: 'CAPTURED',
      providerPaymentId: `pay_rec_${orderId.slice(-6)}`,
    })) as any);

    const reconciled = await paymentService.reconcileStuckPayments();
    expect(reconciled).toBe(2);

    const a1 = await ctx.prisma.appointment.findUnique({ where: { id: validAppt.id } });
    const a2 = await ctx.prisma.appointment.findUnique({ where: { id: cancelledAppt.id } });
    expect(a1?.status).toBe('CONFIRMED');
    expect(a2?.status).toBe('CANCELLED'); // never resurrected

    const outboxConfirmed = await ctx.prisma.outboxEvent.findFirst({
      where: { aggregateId: validAppt.id, eventType: 'APPOINTMENT_CONFIRMED' },
    });
    expect(outboxConfirmed).not.toBeNull();

    const refundRow = await ctx.prisma.refund.findFirst({
      where: { paymentId: c2.paymentId },
    });
    expect(refundRow?.reason).toBe('AUTO_REFUND_LATE_PAYMENT');
  });

  it('P0-9: allows retrying checkout after a payment FAILED without P2002 and captures on retry', async () => {
    const { appt, token } = await seedPendingBooking(70000);

    const first = await ctx.app.inject({
      method: 'POST',
      url: '/api/payments/checkout',
      headers: { authorization: `Bearer ${token}` },
      payload: { appointmentId: appt.id, idempotencyKey: randomUUID() },
    });
    expect(first.statusCode).toBe(201);
    const firstOrder = first.json();

    // Fail the first payment via webhook
    const failBody = Buffer.from(
      JSON.stringify({
        id: `evt_fail_${randomUUID().slice(0, 8)}`,
        event: 'payment.failed',
        payload: {
          payment: {
            entity: {
              id: 'pay_fail_1',
              order_id: firstOrder.providerOrderId,
              amount: 70000,
              currency: 'INR',
            },
          },
        },
      }),
      'utf8',
    );
    const failRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/payments/webhook',
      headers: {
        'content-type': 'application/json',
        'x-razorpay-signature': signFakeWebhook(failBody),
      },
      payload: failBody,
    });
    expect(failRes.statusCode).toBe(200);
    expect(failRes.json().status).toBe('PAYMENT_FAILED');

    // Retry checkout with a new idempotencyKey -> must reuse row, no P2002
    const retry = await ctx.app.inject({
      method: 'POST',
      url: '/api/payments/checkout',
      headers: { authorization: `Bearer ${token}` },
      payload: { appointmentId: appt.id, idempotencyKey: randomUUID() },
    });
    expect(retry.statusCode).toBe(201);
    const retryOrder = retry.json();
    expect(retryOrder.paymentId).toBe(firstOrder.paymentId);
    expect(retryOrder.providerOrderId).not.toBe(firstOrder.providerOrderId);
    expect(retryOrder.status).toBe('INITIATED');

    // Capture on the retried order
    const capBody = Buffer.from(
      JSON.stringify({
        id: `evt_cap_${randomUUID().slice(0, 8)}`,
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: 'pay_ok_2',
              order_id: retryOrder.providerOrderId,
              amount: 70000,
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
        'x-razorpay-signature': signFakeWebhook(capBody),
      },
      payload: capBody,
    });
    expect(capRes.statusCode).toBe(200);
    expect(capRes.json().status).toBe('CAPTURED');
  });

  it('P0-10: rejects PAYMENT_PROVIDER=FAKE in production env and exposes GET /api/payments/config', async () => {
    const prodFake = EnvSchema.safeParse({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      REDIS_URL: 'redis://localhost:6379',
      JWT_SECRET: 'x'.repeat(32),
      COOKIE_SECRET: 'y'.repeat(32),
      PAYMENT_PROVIDER: 'FAKE',
    });
    expect(prodFake.success).toBe(false);

    const cfgRes = await ctx.app.inject({
      method: 'GET',
      url: '/api/payments/config',
    });
    expect(cfgRes.statusCode).toBe(200);
    expect(cfgRes.json()).toEqual({
      provider: 'FAKE',
      simulatorEnabled: true,
    });
  });
});
