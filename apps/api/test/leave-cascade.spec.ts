import { describe, it, expect } from 'vitest';
import { LeaveService } from '../src/modules/scheduling/services/leave.service';
import { PrismaService } from '../src/modules/platform/database/prisma.service';
import { AuditService } from '../src/modules/platform/audit/audit.service';

describe('Domain Rule: Doctor Leave Cascade Cancellation', () => {
  it('previews impacted bookings and cascades cancellations with 100% refund outbox jobs', async () => {
    const existingAppointments = [
      {
        id: 'appt-1',
        bookingRef: 'MB-20270115-001',
        doctorId: 'doc-1',
        patientId: 'patient-1',
        slotTime: new Date('2027-01-15T09:00:00.000Z'),
        status: 'CONFIRMED',
        patient: { id: 'patient-1', name: 'Patient 1', email: 'p1@test.com', phone: '123' },
      },
      {
        id: 'appt-2',
        bookingRef: 'MB-20270115-002',
        doctorId: 'doc-1',
        patientId: 'patient-2',
        slotTime: new Date('2027-01-15T09:30:00.000Z'),
        status: 'CONFIRMED',
        patient: { id: 'patient-2', name: 'Patient 2', email: 'p2@test.com', phone: '456' },
      },
    ];

    const outboxEvents: any[] = [];

    const mockPrisma: any = {
      appointment: {
        findMany: async () => existingAppointments,
        update: async ({ where, data }: any) => {
          const appt = existingAppointments.find((a) => a.id === where.id);
          if (appt) Object.assign(appt, data);
          return appt;
        },
      },
      doctorLeave: {
        create: async ({ data }: any) => ({ id: 'leave-1', ...data }),
      },
      outboxEvent: {
        create: async ({ data }: any) => {
          outboxEvents.push(data);
          return { id: 'outbox-1', ...data };
        },
      },
      $transaction: async (fn: any) => fn(mockPrisma),
    };

    const mockAudit: any = {
      log: async () => {},
    };

    const leaveService = new LeaveService(
      mockPrisma as PrismaService,
      mockAudit as AuditService,
    );

    // 1. Dry run preview
    const preview = await leaveService.previewLeaveImpact(
      'doc-1',
      '2027-01-15',
      '2027-01-15',
    );
    expect(preview.affectedCount).toBe(2);
    expect(preview.appointments.length).toBe(2);

    // 2. Apply leave
    const applied = await leaveService.applyLeave(
      'doc-1',
      '2027-01-15',
      '2027-01-15',
      'Medical Conference in Delhi',
    );

    expect(applied.cancelledCount).toBe(2);

    // Assert all affected appointments transitioned to CANCELLED
    expect(existingAppointments.every((a) => a.status === 'CANCELLED')).toBe(true);

    // Assert 100% full refund outbox events generated
    expect(outboxEvents.length).toBe(2);
    expect(outboxEvents[0].eventType).toBe('AppointmentCancelledByDoctor');
    expect(outboxEvents[0].payload.refundPercent).toBe(100);
  });
});
