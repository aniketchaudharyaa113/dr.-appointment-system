import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  bootTestApp,
  resetDatabaseAndRedis,
  seedVerifiedDoctor,
  seedPatient,
  TestContext,
} from './helpers/test-app';
import { LiveKitService } from '../src/modules/consultation/services/livekit.service';
import { BookingService } from '../src/modules/scheduling/services/booking.service';
import { PrescriptionService } from '../src/modules/consultation/services/prescription.service';
import { ForbiddenException, BadRequestException } from '@nestjs/common';

describe('P1-1 & P1-2: Appointment & Consultation Lifecycle State Machine', () => {
  let ctx: TestContext;
  let liveKitService: LiveKitService;
  let bookingService: BookingService;
  let prescriptionService: PrescriptionService;

  beforeAll(async () => {
    ctx = await bootTestApp();
    await resetDatabaseAndRedis(ctx.prisma, ctx.redisClient);
    liveKitService = ctx.app.get(LiveKitService);
    bookingService = ctx.app.get(BookingService);
    prescriptionService = ctx.app.get(PrescriptionService);
  });

  afterAll(async () => {
    if (ctx) await ctx.app.close();
  });

  it('enforces RBAC and allowed state transitions for consultation session status', async () => {
    const { doctor, user: doctorUser } = await seedVerifiedDoctor(ctx.prisma);
    const patientUser = await seedPatient(ctx.prisma);

    // Create confirmed appointment
    const appt = await ctx.prisma.appointment.create({
      data: {
        bookingRef: `MB-P1-${Date.now().toString(36)}`,
        doctorId: doctor.id,
        patientId: patientUser.id,
        slotTime: new Date(),
        status: 'CONFIRMED',
        consultationMode: 'VIDEO',
      },
    });

    // 1. Patient cannot set LIVE or ENDED (P1-2 RBAC)
    await expect(
      liveKitService.updateSessionStatus(appt.id, patientUser.id, 'LIVE'),
    ).rejects.toThrow(ForbiddenException);

    await expect(
      liveKitService.updateSessionStatus(appt.id, patientUser.id, 'ENDED'),
    ).rejects.toThrow(ForbiddenException);

    // 2. Doctor can start consultation -> transitions session to LIVE and appointment to IN_PROGRESS (P1-1)
    const liveSession = await liveKitService.updateSessionStatus(
      appt.id,
      doctorUser.id,
      'LIVE',
    );
    expect(liveSession.status).toBe('LIVE');
    expect(liveSession.startedAt).toBeDefined();

    const updatedAppt = await ctx.prisma.appointment.findUnique({
      where: { id: appt.id },
    });
    expect(updatedAppt?.status).toBe('IN_PROGRESS');

    // Outbox event was created for IN_PROGRESS
    const inProgressEvent = await ctx.prisma.outboxEvent.findFirst({
      where: {
        aggregateId: appt.id,
        eventType: 'APPOINTMENT_IN_PROGRESS',
      },
    });
    expect(inProgressEvent).toBeDefined();

    // 3. Doctor ends consultation -> transitions session to ENDED and appointment to COMPLETED (P1-1)
    const endedSession = await liveKitService.updateSessionStatus(
      appt.id,
      doctorUser.id,
      'ENDED',
    );
    expect(endedSession.status).toBe('ENDED');
    expect(endedSession.endedAt).toBeDefined();

    const completedAppt = await ctx.prisma.appointment.findUnique({
      where: { id: appt.id },
    });
    expect(completedAppt?.status).toBe('COMPLETED');

    // Outbox event was created for COMPLETED
    const completedEvent = await ctx.prisma.outboxEvent.findFirst({
      where: {
        aggregateId: appt.id,
        eventType: 'APPOINTMENT_COMPLETED',
      },
    });
    expect(completedEvent).toBeDefined();

    // 4. Invalid session transition: cannot transition ENDED back to LIVE (P1-2)
    await expect(
      liveKitService.updateSessionStatus(appt.id, doctorUser.id, 'LIVE'),
    ).rejects.toThrow(BadRequestException);

    // 5. PrescriptionService.createPrescription now succeeds because status is COMPLETED! (P1-1)
    const rx = await prescriptionService.createPrescription(
      appt.id,
      doctorUser.id,
      {
        diagnosis: 'Upper Respiratory Infection',
        advice: 'Rest and hydration',
        medicines: [
          {
            name: 'Paracetamol',
            dosage: '500mg',
            frequency: 'TDS',
            durationDays: 3,
          },
        ],
      },
    );
    expect(rx.id).toBeDefined();
    expect(rx.diagnosis).toBe('Upper Respiratory Infection');
  });

  it('rejects session updates for cancelled or pending appointments', async () => {
    const { doctor, user: doctorUser } = await seedVerifiedDoctor(ctx.prisma);
    const patientUser = await seedPatient(ctx.prisma);

    const cancelledAppt = await ctx.prisma.appointment.create({
      data: {
        bookingRef: `MB-P1-C-${Date.now().toString(36)}`,
        doctorId: doctor.id,
        patientId: patientUser.id,
        slotTime: new Date(),
        status: 'CANCELLED',
        consultationMode: 'VIDEO',
      },
    });

    await expect(
      liveKitService.updateSessionStatus(cancelledAppt.id, doctorUser.id, 'LIVE'),
    ).rejects.toThrow(BadRequestException);
  });

  it('marks CONFIRMED appointments past slotTime + 30m without live session as NO_SHOW', async () => {
    const { doctor } = await seedVerifiedDoctor(ctx.prisma);
    const patientUser = await seedPatient(ctx.prisma);

    const pastSlotTime = new Date(Date.now() - 40 * 60 * 1000); // 40 minutes ago
    const appt = await ctx.prisma.appointment.create({
      data: {
        bookingRef: `MB-P1-NS-${Date.now().toString(36)}`,
        doctorId: doctor.id,
        patientId: patientUser.id,
        slotTime: pastSlotTime,
        status: 'CONFIRMED',
        consultationMode: 'VIDEO',
      },
    });

    const count = await bookingService.markNoShowAppointments();
    expect(count).toBeGreaterThanOrEqual(1);

    const refreshed = await ctx.prisma.appointment.findUnique({
      where: { id: appt.id },
    });
    expect(refreshed?.status).toBe('NO_SHOW');

    const outboxNoShow = await ctx.prisma.outboxEvent.findFirst({
      where: {
        aggregateId: appt.id,
        eventType: 'APPOINTMENT_NO_SHOW',
      },
    });
    expect(outboxNoShow).toBeDefined();
  });
});
