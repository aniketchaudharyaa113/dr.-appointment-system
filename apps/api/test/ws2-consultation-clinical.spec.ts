import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  bootTestApp,
  resetDatabaseAndRedis,
  seedVerifiedDoctor,
  seedPatient,
  signJwtForUser,
  TestContext,
} from './helpers/test-app';
import { LiveKitService } from '../src/modules/consultation/services/livekit.service';
import { BookingService } from '../src/modules/scheduling/services/booking.service';
import { ClinicalService } from '../src/modules/consultation/services/clinical.service';
import { LedgerService } from '../src/modules/payments/services/ledger.service';
import { AuditService } from '../src/modules/platform/audit/audit.service';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

describe('WS2: Consultation, No-Show, Chat & Clinical Integrity (B2, B3, B9, B19, B21)', () => {
  let ctx: TestContext;
  let liveKitService: LiveKitService;
  let bookingService: BookingService;
  let clinicalService: ClinicalService;
  let ledgerService: LedgerService;
  let auditService: AuditService;

  beforeAll(async () => {
    ctx = await bootTestApp();
    liveKitService = ctx.app.get(LiveKitService);
    bookingService = ctx.app.get(BookingService);
    clinicalService = ctx.app.get(ClinicalService);
    ledgerService = ctx.app.get(LedgerService);
    auditService = ctx.app.get(AuditService);
  });

  afterAll(async () => {
    if (ctx) await ctx.app.close();
  });

  beforeEach(async () => {
    await resetDatabaseAndRedis(ctx.prisma, ctx.redisClient);
  });

  it('B2: blocks premature consultation LIVE/ENDED transitions for future appointments', async () => {
    const { doctor, user: doctorUser } = await seedVerifiedDoctor(ctx.prisma);
    const patient = await seedPatient(ctx.prisma);

    const futureSlot = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const appt = await ctx.prisma.appointment.create({
      data: {
        bookingRef: `MB-WS2-B2-${Date.now().toString(36)}`,
        doctorId: doctor.id,
        patientId: patient.id,
        slotTime: futureSlot,
        status: 'CONFIRMED',
        consultationMode: 'VIDEO',
      },
    });

    await expect(
      liveKitService.updateSessionStatus(appt.id, doctorUser.id, 'LIVE'),
    ).rejects.toThrow(BadRequestException);

    await expect(
      liveKitService.updateSessionStatus(appt.id, doctorUser.id, 'ENDED'),
    ).rejects.toThrow(BadRequestException);

    const unchanged = await ctx.prisma.appointment.findUnique({ where: { id: appt.id } });
    expect(unchanged?.status).toBe('CONFIRMED');
  });

  it('B3: rejects POST /consultations/:id/messages/read from non-participants with 403', async () => {
    const { doctor } = await seedVerifiedDoctor(ctx.prisma);
    const patient = await seedPatient(ctx.prisma, 'patient-b3');
    const stranger = await seedPatient(ctx.prisma, 'stranger-b3');

    const appt = await ctx.prisma.appointment.create({
      data: {
        bookingRef: `MB-WS2-B3-${Date.now().toString(36)}`,
        doctorId: doctor.id,
        patientId: patient.id,
        slotTime: new Date(),
        status: 'CONFIRMED',
        consultationMode: 'VIDEO',
      },
    });

    const msg = await ctx.prisma.chatMessage.create({
      data: {
        appointmentId: appt.id,
        senderId: patient.id,
        senderRole: 'PATIENT',
        content: 'Hello Doctor',
        status: 'SENT',
      },
    });

    const strangerToken = signJwtForUser(stranger);
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/consultations/${appt.id}/messages/read`,
      headers: { authorization: `Bearer ${strangerToken}` },
    });

    expect(res.statusCode).toBe(403);

    const reloaded = await ctx.prisma.chatMessage.findUnique({ where: { id: msg.id } });
    expect(reloaded?.status).toBe('SENT');
  });

  it('B9: refunds patient when patient waited (consent/WAITING) and doctor never joined past +30m', async () => {
    const { doctor } = await seedVerifiedDoctor(ctx.prisma);
    const patient = await seedPatient(ctx.prisma, 'patient-b9');

    const pastSlot = new Date(Date.now() - 40 * 60 * 1000);
    const appt = await ctx.prisma.appointment.create({
      data: {
        bookingRef: `MB-WS2-B9-${Date.now().toString(36)}`,
        doctorId: doctor.id,
        patientId: patient.id,
        slotTime: pastSlot,
        status: 'CONFIRMED',
        consultationMode: 'VIDEO',
      },
    });

    const payment = await ctx.prisma.payment.create({
      data: {
        appointmentId: appt.id,
        provider: 'FAKE',
        providerOrderId: 'ord_b9_test',
        providerPaymentId: 'pay_b9_test',
        amountPaise: 50000,
        status: 'CAPTURED',
        idempotencyKey: `idem_b9_${Date.now()}`,
      },
    });
    await ledgerService.recordPaymentCapture(payment.id, 50000);

    // Patient recorded consent and entered WAITING room; doctor never joined
    await liveKitService.recordConsent(appt.id, patient.id);

    await bookingService.markNoShowAppointments();

    const updatedAppt = await ctx.prisma.appointment.findUnique({ where: { id: appt.id } });
    expect(updatedAppt?.status).toBe('CANCELLED');
    expect(updatedAppt?.cancellationReason).toMatch(/doctor/i);

    const refunds = await ctx.prisma.refund.findMany({ where: { paymentId: payment.id } });
    expect(refunds).toHaveLength(1);
    expect(refunds[0].amountPaise).toBe(50000);
    expect(refunds[0].status).toBe('PENDING');

    const isBalanced = await ledgerService.verifyZeroSum(payment.id);
    expect(isBalanced).toBe(true);
  });

  it('B19: blocks join tokens on COMPLETED/NO_SHOW, blocks consent on CANCELLED, allows LIVE overrun reconnect', async () => {
    const { doctor, user: doctorUser } = await seedVerifiedDoctor(ctx.prisma);
    const patient = await seedPatient(ctx.prisma, 'patient-b19');

    const now = new Date();
    const completedAppt = await ctx.prisma.appointment.create({
      data: {
        bookingRef: `MB-WS2-B19A-${Date.now().toString(36)}`,
        doctorId: doctor.id,
        patientId: patient.id,
        slotTime: now,
        status: 'COMPLETED',
        consultationMode: 'VIDEO',
      },
    });

    await expect(
      liveKitService.mintJoinToken(completedAppt.id, doctorUser.id, now),
    ).rejects.toThrow(BadRequestException);

    const noShowAppt = await ctx.prisma.appointment.create({
      data: {
        bookingRef: `MB-WS2-B19B-${Date.now().toString(36)}`,
        doctorId: doctor.id,
        patientId: patient.id,
        slotTime: now,
        status: 'NO_SHOW',
        consultationMode: 'VIDEO',
      },
    });

    await expect(
      liveKitService.mintJoinToken(noShowAppt.id, doctorUser.id, now),
    ).rejects.toThrow(BadRequestException);

    const cancelledAppt = await ctx.prisma.appointment.create({
      data: {
        bookingRef: `MB-WS2-B19C-${Date.now().toString(36)}`,
        doctorId: doctor.id,
        patientId: patient.id,
        slotTime: now,
        status: 'CANCELLED',
        consultationMode: 'VIDEO',
      },
    });

    await expect(
      liveKitService.recordConsent(cancelledAppt.id, patient.id),
    ).rejects.toThrow(BadRequestException);

    // LIVE consultation overrun past +30m can still mint reconnect token
    const overrunSlot = new Date(now.getTime() - 45 * 60 * 1000);
    const liveAppt = await ctx.prisma.appointment.create({
      data: {
        bookingRef: `MB-WS2-B19D-${Date.now().toString(36)}`,
        doctorId: doctor.id,
        patientId: patient.id,
        slotTime: overrunSlot,
        status: 'IN_PROGRESS',
        consultationMode: 'VIDEO',
      },
    });
    await ctx.prisma.consultationSession.create({
      data: {
        appointmentId: liveAppt.id,
        roomName: `consult-${liveAppt.id}`,
        status: 'LIVE',
        startedAt: overrunSlot,
        patientConsentGiven: true,
        consentTimestamp: overrunSlot,
      },
    });

    const reconnect = await liveKitService.mintJoinToken(liveAppt.id, patient.id, now);
    expect(reconnect.token).toBeTruthy();
  });

  it('B21: guards createLabOrder, updateLabResults notes-only & terminal transitions, and tx audit rollback', async () => {
    const { doctor, user: doctorUser } = await seedVerifiedDoctor(ctx.prisma);
    const patient = await seedPatient(ctx.prisma, 'patient-b21');

    // 1. Cannot order lab on PENDING_PAYMENT, CANCELLED, or far-future appointment
    const pendingAppt = await ctx.prisma.appointment.create({
      data: {
        bookingRef: `MB-WS2-B21A-${Date.now().toString(36)}`,
        doctorId: doctor.id,
        patientId: patient.id,
        slotTime: new Date(),
        status: 'PENDING_PAYMENT',
        consultationMode: 'VIDEO',
      },
    });
    await expect(
      clinicalService.createLabOrder(pendingAppt.id, doctorUser.id, {
        testName: 'CBC',
        testCode: 'CBC-1',
      }),
    ).rejects.toThrow(BadRequestException);

    const futureAppt = await ctx.prisma.appointment.create({
      data: {
        bookingRef: `MB-WS2-B21B-${Date.now().toString(36)}`,
        doctorId: doctor.id,
        patientId: patient.id,
        slotTime: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
        status: 'CONFIRMED',
        consultationMode: 'VIDEO',
      },
    });
    await expect(
      clinicalService.createLabOrder(futureAppt.id, doctorUser.id, {
        testName: 'CBC',
        testCode: 'CBC-2',
      }),
    ).rejects.toThrow(BadRequestException);

    // 2. Updating only resultNotes does NOT mark COMPLETED, and COMPLETED cannot be reopened
    const activeAppt = await ctx.prisma.appointment.create({
      data: {
        bookingRef: `MB-WS2-B21C-${Date.now().toString(36)}`,
        doctorId: doctor.id,
        patientId: patient.id,
        slotTime: new Date(),
        status: 'CONFIRMED',
        consultationMode: 'VIDEO',
      },
    });

    const labOrder = await clinicalService.createLabOrder(activeAppt.id, doctorUser.id, {
      testName: 'TSH',
      testCode: 'TSH-1',
    });

    const doctorToken = signJwtForUser(doctorUser);
    const notesOnlyRes = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/lab-orders/${labOrder.id}`,
      headers: { authorization: `Bearer ${doctorToken}` },
      payload: { resultNotes: 'Sample received at lab' },
    });
    expect(notesOnlyRes.statusCode).toBe(200);
    expect(notesOnlyRes.json().status).toBe('ORDERED');
    expect(notesOnlyRes.json().completedAt).toBeNull();

    const completedRes = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/lab-orders/${labOrder.id}`,
      headers: { authorization: `Bearer ${doctorToken}` },
      payload: { status: 'COMPLETED', results: { tsh: '2.1 mIU/L' } },
    });
    expect(completedRes.statusCode).toBe(200);
    expect(completedRes.json().status).toBe('COMPLETED');

    const reopenRes = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/lab-orders/${labOrder.id}`,
      headers: { authorization: `Bearer ${doctorToken}` },
      payload: { status: 'PROCESSING' },
    });
    expect(reopenRes.statusCode).toBe(400);

    // 3. AuditService supports transactional client so rolled-back tx leaves no orphan audit row
    const resourceId = `rollback-${Date.now()}`;
    await expect(
      ctx.prisma.$transaction(async (tx) => {
        await auditService.log(
          {
            userId: doctorUser.id,
            action: 'CREATE_PRESCRIPTION',
            resource: 'PRESCRIPTION',
            resourceId,
          },
          tx,
        );
        throw new Error('Force rollback');
      }),
    ).rejects.toThrow('Force rollback');

    const orphanAudit = await ctx.prisma.auditLog.findFirst({
      where: { resourceId },
    });
    expect(orphanAudit).toBeNull();
  });
});
