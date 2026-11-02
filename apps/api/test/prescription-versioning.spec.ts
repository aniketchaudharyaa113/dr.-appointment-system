import { describe, it, expect, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { PrescriptionService } from '../src/modules/consultation/services/prescription.service';

describe('Phase 5: Prescription Creation, Immutable Versioning, and PHI Read Audit', () => {
  let prescriptionService: PrescriptionService;

  const appointmentId = 'appt-rx-1';
  const doctorId = 'doc-db-uuid-1';
  const doctorUserId = 'doctor-user-uuid-1';
  const patientId = 'patient-uuid-1';

  let appointmentStatus: string;
  let prescriptionRecord: any;
  let prescriptionVersions: any[];
  let auditLogs: any[];

  beforeEach(() => {
    appointmentStatus = 'CONFIRMED'; // Starts in CONFIRMED, not yet COMPLETED
    prescriptionRecord = null;
    prescriptionVersions = [];
    auditLogs = [];

    const mockPrisma: any = {
      appointment: {
        findUnique: () => ({
          id: appointmentId,
          doctorId,
          patientId,
          status: appointmentStatus,
          doctor: { userId: doctorUserId },
          prescription: prescriptionRecord,
        }),
      },
      prescription: {
        create: ({ data }: any) => {
          prescriptionRecord = {
            ...data,
            id: 'rx-100',
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          return prescriptionRecord;
        },
        update: ({ data }: any) => {
          Object.assign(prescriptionRecord, data);
          return prescriptionRecord;
        },
      },
      prescriptionVersion: {
        create: ({ data }: any) => {
          const v = { ...data, id: `rx-v-${prescriptionVersions.length + 1}` };
          prescriptionVersions.push(v);
          return v;
        },
      },
      $transaction: async (cb: any) => cb(mockPrisma),
    };

    const mockAuditService: any = {
      log: (entry: any) => {
        auditLogs.push(entry);
        return entry;
      },
      logPhiRead: (userId: string, patientId: string, resource: string, resourceId: string) => {
        const entry = { action: 'READ_PHI', userId, patientId, resource, resourceId };
        auditLogs.push(entry);
        return entry;
      },
    };


    prescriptionService = new PrescriptionService(mockPrisma, mockAuditService);
  });

  it('rejects prescription issuance if appointment is not yet COMPLETED', async () => {
    appointmentStatus = 'CONFIRMED';

    await expect(
      prescriptionService.createPrescription(appointmentId, doctorUserId, {
        diagnosis: 'Acute Bronchitis',
        medicines: [
          {
            name: 'Amoxicillin',
            dosage: '500mg',
            frequency: 'TDS',
            durationDays: 5,
          },
        ],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('allows prescription issuance once COMPLETED and creates version 1', async () => {
    appointmentStatus = 'COMPLETED';

    const rx = await prescriptionService.createPrescription(
      appointmentId,
      doctorUserId,
      {
        diagnosis: 'Acute Bronchitis',
        medicines: [
          {
            name: 'Amoxicillin',
            dosage: '500mg',
            frequency: 'TDS',
            durationDays: 5,
          },
        ],
        advice: 'Drink warm water and rest.',
      },
    );

    expect(rx).toBeDefined();
    expect(rx.currentVersion).toBe(1);
    expect(prescriptionVersions.length).toBe(1);
    expect(prescriptionVersions[0].version).toBe(1);
    expect(prescriptionVersions[0].diagnosis).toBe('Acute Bronchitis');
  });

  it('creates an immutable version 2 upon update without modifying version 1', async () => {
    appointmentStatus = 'COMPLETED';

    // Create v1
    await prescriptionService.createPrescription(appointmentId, doctorUserId, {
      diagnosis: 'Acute Bronchitis',
      medicines: [{ name: 'Amoxicillin', dosage: '500mg', frequency: 'TDS', durationDays: 5 }],
    });

    // Update to v2
    const updated = await prescriptionService.updatePrescription(
      appointmentId,
      doctorUserId,
      {
        diagnosis: 'Acute Bronchitis with Mild Asthma',
        medicines: [
          { name: 'Amoxicillin', dosage: '500mg', frequency: 'TDS', durationDays: 5 },
          { name: 'Salbutamol Inhaler', dosage: '100mcg', frequency: 'PRN', durationDays: 7 },
        ],
        advice: 'Use inhaler as needed.',
      },
    );

    expect(updated.currentVersion).toBe(2);
    expect(prescriptionVersions.length).toBe(2);

    // Version 1 remains unchanged
    expect(prescriptionVersions[0].version).toBe(1);
    expect(prescriptionVersions[0].diagnosis).toBe('Acute Bronchitis');

    // Version 2 has updated diagnosis
    expect(prescriptionVersions[1].version).toBe(2);
    expect(prescriptionVersions[1].diagnosis).toBe('Acute Bronchitis with Mild Asthma');
  });

  it('records an immutable PHI read audit log when viewing a prescription', async () => {
    appointmentStatus = 'COMPLETED';

    await prescriptionService.createPrescription(appointmentId, doctorUserId, {
      diagnosis: 'Tension Headache',
      medicines: [{ name: 'Paracetamol', dosage: '650mg', frequency: 'SOS', durationDays: 3 }],
    });

    // Patient views their prescription
    await prescriptionService.getPrescription(appointmentId, patientId);

    const phiRead = auditLogs.find(
      (l) => l.action === 'READ_PHI' && l.resource === 'PRESCRIPTION',
    );
    expect(phiRead).toBeDefined();
    expect(phiRead.userId).toBe(patientId);
  });
});
