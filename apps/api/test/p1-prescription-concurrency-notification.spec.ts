import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  bootTestApp,
  resetDatabaseAndRedis,
  seedVerifiedDoctor,
  seedPatient,
  TestContext,
} from './helpers/test-app';
import { PrescriptionService } from '../src/modules/consultation/services/prescription.service';

describe('P1-14: Prescription Concurrency Locking & Patient Notifications', () => {
  let ctx: TestContext;
  let prescriptionService: PrescriptionService;

  beforeAll(async () => {
    ctx = await bootTestApp();
    await resetDatabaseAndRedis(ctx.prisma, ctx.redisClient);
    prescriptionService = ctx.app.get(PrescriptionService);
  });

  afterAll(async () => {
    if (ctx) await ctx.app.close();
  });

  it('creates multi-medicine prescription, locks appointment, and notifies patient', async () => {
    const { doctor, user: docUser } = await seedVerifiedDoctor(ctx.prisma);
    const patient = await seedPatient(ctx.prisma);

    const appt = await ctx.prisma.appointment.create({
      data: {
        bookingRef: `MB-RX-${Math.random().toString(36).slice(2, 8)}`,
        doctorId: doctor.id,
        patientId: patient.id,
        slotTime: new Date(),
        status: 'COMPLETED',
        consultationMode: 'VIDEO',
      },
    });

    const medicines = [
      { name: 'Telmisartan', dosage: '40mg', frequency: '1-0-0', durationDays: 30 },
      { name: 'Amlodipine', dosage: '5mg', frequency: '0-0-1', durationDays: 30 },
      { name: 'Atorvastatin', dosage: '10mg', frequency: '0-0-1', durationDays: 30 },
    ];

    // 1. Issue Prescription (Version 1)
    const rx = await prescriptionService.createPrescription(appt.id, docUser.id, {
      diagnosis: 'Primary Hypertension & Dyslipidemia',
      medicines,
      advice: 'Low salt diet, daily brisk walking for 30 minutes.',
    });

    expect(rx.currentVersion).toBe(1);
    expect(rx.diagnosis).toBe('Primary Hypertension & Dyslipidemia');

    // Verify patient received notification
    const notification = await ctx.prisma.notification.findFirst({
      where: { userId: patient.id, type: 'PRESCRIPTION_ISSUED' },
    });
    expect(notification).toBeDefined();
    expect(notification?.title).toBe('Digital Prescription Issued');

    // Verify outbox event
    const outbox = await ctx.prisma.outboxEvent.findFirst({
      where: { aggregateId: rx.id, eventType: 'PRESCRIPTION_ISSUED' },
    });
    expect(outbox).toBeDefined();

    // 2. Append Prescription Version 2
    const updatedRx = await prescriptionService.updatePrescription(appt.id, docUser.id, {
      diagnosis: 'Primary Hypertension (Controlled) & Dyslipidemia',
      medicines: [
        ...medicines,
        { name: 'EcoSprin', dosage: '75mg', frequency: '0-1-0', durationDays: 30 },
      ],
      advice: 'Blood pressure well-controlled. Continue regimen.',
    });

    expect(updatedRx.currentVersion).toBe(2);

    // Verify immutable versions exist
    const versions = await ctx.prisma.prescriptionVersion.findMany({
      where: { prescriptionId: rx.id },
      orderBy: { version: 'asc' },
    });
    expect(versions).toHaveLength(2);
    expect(versions[0].version).toBe(1);
    expect(versions[1].version).toBe(2);

    // Verify update notification
    const updateNotification = await ctx.prisma.notification.findFirst({
      where: { userId: patient.id, type: 'PRESCRIPTION_UPDATED' },
    });
    expect(updateNotification).toBeDefined();
    expect(updateNotification?.body).toContain('Version 2');
  });
});
