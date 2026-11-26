import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  bootTestApp,
  resetDatabaseAndRedis,
  seedVerifiedDoctor,
  seedPatient,
  TestContext,
} from './helpers/test-app';
import { AdminService } from '../src/modules/admin/admin.service';
import { DoctorService } from '../src/modules/scheduling/services/doctor.service';

describe('P1-11: Admin Operations & Doctor Dashboards', () => {
  let ctx: TestContext;
  let adminService: AdminService;
  let doctorService: DoctorService;

  beforeAll(async () => {
    ctx = await bootTestApp();
    await resetDatabaseAndRedis(ctx.prisma, ctx.redisClient);
    adminService = ctx.app.get(AdminService);
    doctorService = ctx.app.get(DoctorService);
  });

  afterAll(async () => {
    if (ctx) await ctx.app.close();
  });

  it('aggregates real platform statistics, double-entry ledgers, and audit logs for admin', async () => {
    const { doctor, user: docUser } = await seedVerifiedDoctor(ctx.prisma);
    const patient = await seedPatient(ctx.prisma);

    // Seed a pending doctor
    const pendingDocUser = await ctx.prisma.user.create({
      data: {
        email: `pending-${Math.random().toString(36).slice(2, 7)}@example.com`,
        passwordHash: 'dummy',
        name: 'Dr. Pending Verification',
        role: 'DOCTOR',
      },
    });
    await ctx.prisma.doctor.create({
      data: {
        userId: pendingDocUser.id,
        specialty: 'Pediatrics',
        licenseNumber: 'DOC-VERIF-TEST',
        consultationFeePaise: 50000,
        isVerified: false,
        verificationStatus: 'PENDING',
      },
    });

    // Seed an appointment and payment with ledger entry
    const appt = await ctx.prisma.appointment.create({
      data: {
        bookingRef: `MB-ADM-${Math.random().toString(36).slice(2, 8)}`,
        doctorId: doctor.id,
        patientId: patient.id,
        slotTime: new Date(),
        status: 'CONFIRMED',
        consultationMode: 'VIDEO',
      },
    });

    const payment = await ctx.prisma.payment.create({
      data: {
        appointmentId: appt.id,
        amountPaise: 60000,
        currency: 'INR',
        status: 'CAPTURED',
        provider: 'RAZORPAY',
        providerOrderId: `order_${Math.random().toString(36).slice(2, 8)}`,
        idempotencyKey: `idemp_${Math.random().toString(36).slice(2, 8)}`,
      },
    });

    await ctx.prisma.ledgerEntry.createMany({
      data: [
        {
          transactionId: payment.id,
          accountType: 'DOCTOR_PAYABLE',
          entryType: 'CREDIT',
          amountPaise: 50000,
          description: 'Consultation fee credit',
        },
        {
          transactionId: payment.id,
          accountType: 'PLATFORM_REVENUE',
          entryType: 'CREDIT',
          amountPaise: 10000,
          description: 'Platform commission',
        },
      ],
    });

    // Seed audit log
    await ctx.prisma.auditLog.create({
      data: {
        userId: docUser.id,
        action: 'CONSULTATION_SESSION_JOINED',
        resource: 'Appointment',
        resourceId: appt.id,
        ipAddress: '127.0.0.1',
      },
    });

    // 1. Check getAdminStats
    const stats = await adminService.getAdminStats();
    expect(stats.pendingDoctorsCount).toBeGreaterThanOrEqual(1);
    expect(stats.totalPlatformRevenuePaise).toBeGreaterThanOrEqual(60000);
    expect(stats.totalDoctors).toBeGreaterThanOrEqual(1);
    expect(stats.totalPatients).toBeGreaterThanOrEqual(1);

    // 2. Check getLedgerEntries
    const ledgers = await adminService.getLedgerEntries();
    expect(ledgers.length).toBeGreaterThanOrEqual(2);
    expect(ledgers[0].reference).toBe(appt.bookingRef);

    // 3. Check getAuditLogs
    const auditLogs = await adminService.getAuditLogs();
    expect(auditLogs.length).toBeGreaterThanOrEqual(1);
    expect(auditLogs[0].action).toBe('CONSULTATION_SESSION_JOINED');

    // 4. Trigger reconciliation
    const reconResult = await adminService.reconcilePayments();
    expect(reconResult).toBeDefined();
    expect(reconResult.reconciledCount).toBeDefined();
  });

  it('delivers real-time doctor workspace data: earnings, queue, chart, and patient reviews', async () => {
    const { doctor, user: docUser } = await seedVerifiedDoctor(ctx.prisma);
    const patient = await seedPatient(ctx.prisma);

    // Create today's appointment
    const appt = await ctx.prisma.appointment.create({
      data: {
        bookingRef: `MB-DOC-${Math.random().toString(36).slice(2, 8)}`,
        doctorId: doctor.id,
        patientId: patient.id,
        slotTime: new Date(),
        status: 'CONFIRMED',
        consultationMode: 'VIDEO',
      },
    });

    const payment = await ctx.prisma.payment.create({
      data: {
        appointmentId: appt.id,
        amountPaise: 80000,
        currency: 'INR',
        status: 'CAPTURED',
        provider: 'RAZORPAY',
        providerOrderId: `order_doc_${Math.random().toString(36).slice(2, 8)}`,
        idempotencyKey: `idemp_doc_${Math.random().toString(36).slice(2, 8)}`,
      },
    });

    await ctx.prisma.ledgerEntry.create({
      data: {
        transactionId: payment.id,
        accountType: 'DOCTOR_PAYABLE',
        entryType: 'CREDIT',
        amountPaise: 80000,
        description: 'Doctor consultation fee',
      },
    });

    // Add a review
    await ctx.prisma.review.create({
      data: {
        appointmentId: appt.id,
        doctorId: doctor.id,
        patientId: patient.id,
        rating: 5,
        comment: 'Outstanding cardiac specialist, highly recommended!',
      },
    });

    const dashboard = await doctorService.getDoctorDashboard(docUser.id);
    expect(dashboard.doctorId).toBe(doctor.id);
    expect(dashboard.stats.totalEarningsPaise).toBeGreaterThanOrEqual(80000);
    expect(dashboard.todayQueue.length).toBeGreaterThanOrEqual(1);
    expect(dashboard.todayQueue[0].id).toBe(appt.id);
    expect(dashboard.todayQueue[0].patientName).toBe(patient.name);
    expect(dashboard.reviews.length).toBe(1);
    expect(dashboard.reviews[0].rating).toBe(5);
    expect(dashboard.reviews[0].comment).toContain('Outstanding');
    expect(dashboard.earningsChart).toHaveLength(7);
  });
});
