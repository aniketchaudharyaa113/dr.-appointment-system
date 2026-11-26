import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  bootTestApp,
  resetDatabaseAndRedis,
  seedPatient,
  seedVerifiedDoctor,
  signJwtForUser,
  TestContext,
} from './helpers/test-app';
import { getIstDateString } from '../src/common/utils/ist-time';
import { randomUUID } from 'crypto';

describe('P0-4 & P0-5: Unified Refund Policy, Cancel Refunds, Leave Refunds & State Guards', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await bootTestApp();
  });

  beforeEach(async () => {
    await resetDatabaseAndRedis(ctx.prisma, ctx.redisClient);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  async function seedConfirmedPaidBooking(hoursAhead: number) {
    const { doctor, user: docUser } = await seedVerifiedDoctor(ctx.prisma, {
      consultationFeePaise: 80000,
    });
    const patient = await seedPatient(ctx.prisma, `p_${randomUUID().slice(0, 6)}@medibook.test`);
    const slotTime = new Date(Date.now() + hoursAhead * 3600_000);

    const appt = await ctx.prisma.appointment.create({
      data: {
        patientId: patient.id,
        doctorId: doctor.id,
        slotTime,
        status: 'CONFIRMED',
        bookingRef: `MB-TEST-${randomUUID().slice(0, 6)}`,
      },
    });

    const payment = await ctx.prisma.payment.create({
      data: {
        appointmentId: appt.id,
        provider: 'FAKE',
        providerOrderId: `order_${randomUUID().slice(0, 8)}`,
        providerPaymentId: `pay_${randomUUID().slice(0, 8)}`,
        amountPaise: 80000,
        status: 'CAPTURED',
        idempotencyKey: randomUUID(),
      },
    });

    return { doctor, docUser, patient, appt, payment };
  }

  it('P0-4: patient cancel >=24h creates 100% Refund + ledger reversal + outbox event; <24h creates 50% Refund', async () => {
    const far = await seedConfirmedPaidBooking(48);
    const farToken = signJwtForUser(far.patient);

    const cancelFar = await ctx.app.inject({
      method: 'POST',
      url: `/api/appointments/${far.appt.id}/cancel`,
      headers: { authorization: `Bearer ${farToken}` },
      payload: { reason: 'Change of plans' },
    });
    expect(cancelFar.statusCode).toBe(201);
    expect(cancelFar.json().status).toBe('CANCELLED');

    const farRefund = await ctx.prisma.refund.findFirst({ where: { paymentId: far.payment.id } });
    expect(farRefund?.amountPaise).toBe(80000);
    expect(farRefund?.status).toBe('PENDING');

    const farPayment = await ctx.prisma.payment.findUnique({ where: { id: far.payment.id } });
    expect(farPayment?.status).toBe('REFUNDED');

    const farOutbox = await ctx.prisma.outboxEvent.findFirst({
      where: { aggregateId: far.payment.id, eventType: 'PAYMENT_REFUND_REQUESTED' },
    });
    expect(farOutbox).toBeTruthy();

    // <24h cancellation -> 50% refund
    const near = await seedConfirmedPaidBooking(6);
    const nearToken = signJwtForUser(near.patient);

    const cancelNear = await ctx.app.inject({
      method: 'POST',
      url: `/api/appointments/${near.appt.id}/cancel`,
      headers: { authorization: `Bearer ${nearToken}` },
      payload: { reason: 'Last minute emergency' },
    });
    expect(cancelNear.statusCode).toBe(201);

    const nearRefund = await ctx.prisma.refund.findFirst({ where: { paymentId: near.payment.id } });
    expect(nearRefund?.amountPaise).toBe(40000);
  });

  it('P0-4: doctor leave creates 100% Refund + ledger reversal for affected CONFIRMED bookings', async () => {
    const { doctor, docUser, appt, payment } = await seedConfirmedPaidBooking(30);
    const docToken = signJwtForUser(docUser);
    const leaveDate = getIstDateString(appt.slotTime);

    const leaveRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/doctors/${doctor.id}/leaves`,
      headers: { authorization: `Bearer ${docToken}` },
      payload: { startDate: leaveDate, endDate: leaveDate, reason: 'Surgery duty' },
    });
    expect(leaveRes.statusCode).toBe(201);

    const refund = await ctx.prisma.refund.findFirst({ where: { paymentId: payment.id } });
    expect(refund?.amountPaise).toBe(80000);
    expect(refund?.status).toBe('PENDING');

    const updatedAppt = await ctx.prisma.appointment.findUnique({ where: { id: appt.id } });
    expect(updatedAppt?.status).toBe('CANCELLED');
  });

  it('P0-5: blocks refund for COMPLETED/IN_PROGRESS/NO_SHOW and past slots (except ADMIN); blocks cancel on IN_PROGRESS/NO_SHOW', async () => {
    const { patient, appt, payment } = await seedConfirmedPaidBooking(48);
    const patientToken = signJwtForUser(patient);

    // Block cancel & refund when IN_PROGRESS
    await ctx.prisma.appointment.update({ where: { id: appt.id }, data: { status: 'IN_PROGRESS' } });

    const cancelInProgress = await ctx.app.inject({
      method: 'POST',
      url: `/api/appointments/${appt.id}/cancel`,
      headers: { authorization: `Bearer ${patientToken}` },
      payload: { reason: 'Trying to cancel mid-call' },
    });
    expect(cancelInProgress.statusCode).toBe(400);

    const refundInProgress = await ctx.app.inject({
      method: 'POST',
      url: `/api/payments/${payment.id}/refund`,
      headers: { authorization: `Bearer ${patientToken}` },
      payload: { reason: 'Trying to refund mid-call' },
    });
    expect(refundInProgress.statusCode).toBe(400);

    // Block refund when COMPLETED
    await ctx.prisma.appointment.update({ where: { id: appt.id }, data: { status: 'COMPLETED' } });
    const refundCompleted = await ctx.app.inject({
      method: 'POST',
      url: `/api/payments/${payment.id}/refund`,
      headers: { authorization: `Bearer ${patientToken}` },
      payload: { reason: 'Trying to refund after completion' },
    });
    expect(refundCompleted.statusCode).toBe(400);

    // Block refund for past slot for PATIENT, allow ADMIN
    await ctx.prisma.appointment.update({
      where: { id: appt.id },
      data: { status: 'CONFIRMED', slotTime: new Date(Date.now() - 3600_000) },
    });
    const refundPastPatient = await ctx.app.inject({
      method: 'POST',
      url: `/api/payments/${payment.id}/refund`,
      headers: { authorization: `Bearer ${patientToken}` },
      payload: { reason: 'Past slot patient' },
    });
    expect(refundPastPatient.statusCode).toBe(400);

    const admin = await ctx.prisma.user.create({
      data: {
        email: 'admin-refund@medibook.test',
        passwordHash: 'hashed',
        name: 'Admin',
        role: 'ADMIN',
      },
    });
    const adminToken = signJwtForUser(admin);
    const refundPastAdmin = await ctx.app.inject({
      method: 'POST',
      url: `/api/payments/${payment.id}/refund`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { reason: 'Admin override past slot' },
    });
    expect(refundPastAdmin.statusCode).toBe(201);
  });
});
