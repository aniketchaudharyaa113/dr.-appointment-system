import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  bootTestApp,
  resetDatabaseAndRedis,
  seedVerifiedDoctor,
  seedPatient,
  TestContext,
} from './helpers/test-app';
import { ClinicalService } from '../src/modules/consultation/services/clinical.service';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

describe('P1-6: Diagnostic Lab Order Results & Health Passport Integration', () => {
  let ctx: TestContext;
  let clinicalService: ClinicalService;

  beforeAll(async () => {
    ctx = await bootTestApp();
    await resetDatabaseAndRedis(ctx.prisma, ctx.redisClient);
    clinicalService = ctx.app.get(ClinicalService);
  });

  afterAll(async () => {
    if (ctx) await ctx.app.close();
  });

  it('allows ordering doctor to update lab order results and surface in Health Passport', async () => {
    const { doctor: docA, user: docUserA } = await seedVerifiedDoctor(ctx.prisma);
    const patient = await seedPatient(ctx.prisma);

    const appt = await ctx.prisma.appointment.create({
      data: {
        bookingRef: `MB-LAB-${Math.random().toString(36).slice(2, 8)}`,
        doctorId: docA.id,
        patientId: patient.id,
        slotTime: new Date(),
        status: 'CONFIRMED',
        consultationMode: 'VIDEO',
      },
    });

    // 1. Doctor creates a diagnostic lab order
    const labOrder = await clinicalService.createLabOrder(appt.id, docUserA.id, {
      testName: 'Complete Blood Count (CBC)',
      testCode: 'CBC-001',
      urgency: 'ROUTINE',
      instructions: 'Fasting 8 hours prior',
    });

    expect(labOrder.status).toBe('ORDERED');
    expect(labOrder.completedAt).toBeNull();

    // 2. Ordering doctor updates lab results
    const updated = await clinicalService.updateLabResults(labOrder.id, docUserA.id, {
      status: 'COMPLETED',
      results: {
        hemoglobin: '14.2 g/dL',
        wbc: '6,500 /mcL',
        platelets: '250,000 /mcL',
      },
      resultNotes: 'Normal hematology panel, no abnormalities observed.',
    });

    expect(updated.status).toBe('COMPLETED');
    expect(updated.completedAt).toBeDefined();
    expect(updated.resultNotes).toBe('Normal hematology panel, no abnormalities observed.');
    expect((updated.resultsJson as any).hemoglobin).toBe('14.2 g/dL');

    // 3. Patient views Health Passport, results and completedAt are surfaced
    const passport = await clinicalService.getHealthPassport(patient.id);
    expect(passport.labOrders.length).toBeGreaterThanOrEqual(1);

    const passportLabOrder = passport.labOrders.find((o) => o.id === labOrder.id);
    expect(passportLabOrder).toBeDefined();
    expect(passportLabOrder?.status).toBe('COMPLETED');
    expect(passportLabOrder?.completedAt).toBeDefined();
    expect(passportLabOrder?.resultNotes).toBe('Normal hematology panel, no abnormalities observed.');
    expect((passportLabOrder?.resultsJson as any).hemoglobin).toBe('14.2 g/dL');
  });

  it('rejects update attempts from non-ordering doctors or unauthorized users', async () => {
    const { doctor: docA, user: docUserA } = await seedVerifiedDoctor(ctx.prisma);
    const { user: docUserB } = await seedVerifiedDoctor(ctx.prisma);
    const patient = await seedPatient(ctx.prisma);

    const appt = await ctx.prisma.appointment.create({
      data: {
        bookingRef: `MB-LAB2-${Math.random().toString(36).slice(2, 8)}`,
        doctorId: docA.id,
        patientId: patient.id,
        slotTime: new Date(),
        status: 'CONFIRMED',
        consultationMode: 'VIDEO',
      },
    });

    const labOrder = await clinicalService.createLabOrder(appt.id, docUserA.id, {
      testName: 'Lipid Panel',
      testCode: 'LIP-002',
    });

    // Doc B cannot update Doc A's lab order
    await expect(
      clinicalService.updateLabResults(labOrder.id, docUserB.id, {
        status: 'COMPLETED',
        results: { cholesterol: '180 mg/dL' },
      }),
    ).rejects.toThrow(ForbiddenException);

    // Patient cannot update lab results
    await expect(
      clinicalService.updateLabResults(labOrder.id, patient.id, {
        status: 'COMPLETED',
        results: 'Forged result',
      }),
    ).rejects.toThrow(ForbiddenException);

    // Non-existent lab order throws NotFoundException
    await expect(
      clinicalService.updateLabResults('00000000-0000-0000-0000-000000000000', docUserA.id, {
        status: 'COMPLETED',
      }),
    ).rejects.toThrow(NotFoundException);
  });
});
