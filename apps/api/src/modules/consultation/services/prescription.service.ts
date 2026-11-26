import {
  Injectable,
  Inject,
  ForbiddenException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../platform/database/prisma.service';
import { AuditService } from '../../platform/audit/audit.service';

export interface MedicineInput {
  name: string;
  dosage: string;
  frequency: string;
  durationDays: number;
  instructions?: string;
}

export interface PrescriptionPayload {
  diagnosis: string;
  medicines: MedicineInput[];
  advice?: string;
}

@Injectable()
export class PrescriptionService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly auditService: AuditService,
  ) {}

  /**
   * Creates a new prescription for an appointment.
   * Invariant: Can ONLY be created for COMPLETED appointments by the designated doctor.
   */
  async createPrescription(
    appointmentId: string,
    doctorUserId: string,
    data: PrescriptionPayload,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // 1. Lock appointment row for concurrency protection
      const [apptRow] = await tx.$queryRaw<
        Array<{
          id: string;
          doctor_id: string;
          patient_id: string;
          status: string;
          doctor_user_id: string;
        }>
      >`
        SELECT a.id, a.doctor_id, a.patient_id, a.status, d.user_id as doctor_user_id
        FROM appointments a
        JOIN doctors d ON d.id = a.doctor_id
        WHERE a.id = ${appointmentId}::uuid
        FOR UPDATE
      `;

      if (!apptRow) {
        throw new NotFoundException(`Appointment ${appointmentId} not found`);
      }

      if (apptRow.doctor_user_id !== doctorUserId) {
        throw new ForbiddenException(
          'Only the assigned doctor can issue a prescription for this appointment',
        );
      }

      if (apptRow.status !== 'COMPLETED') {
        throw new BadRequestException(
          `Cannot issue prescription for appointment in status ${apptRow.status}. Appointment must be COMPLETED.`,
        );
      }

      const existing = await tx.prescription.findUnique({
        where: { appointmentId },
      });
      if (existing) {
        throw new BadRequestException(
          'A prescription already exists for this appointment. Use updatePrescription to create a new immutable version.',
        );
      }

      const prescription = await tx.prescription.create({
        data: {
          appointmentId,
          doctorId: apptRow.doctor_id,
          patientId: apptRow.patient_id,
          diagnosis: data.diagnosis,
          medicines: data.medicines as any,
          advice: data.advice,
          currentVersion: 1,
        },
      });

      await tx.prescriptionVersion.create({
        data: {
          prescriptionId: prescription.id,
          version: 1,
          diagnosis: data.diagnosis,
          medicines: data.medicines as any,
          advice: data.advice,
        },
      });

      // Audit log the creation
      await this.auditService.log({
        userId: doctorUserId,
        action: 'CREATE_PRESCRIPTION',
        resource: 'PRESCRIPTION',
        resourceId: prescription.id,
        details: { version: 1, diagnosis: data.diagnosis },
      });

      // Notify patient of digital prescription issuance
      await tx.notification.create({
        data: {
          userId: apptRow.patient_id,
          type: 'PRESCRIPTION_ISSUED',
          title: 'Digital Prescription Issued',
          body: `Your prescription for consultation ${appointmentId.slice(0, 8)} is now available in your Health Passport.`,
          metadata: {
            appointmentId,
            prescriptionId: prescription.id,
            version: 1,
          },
        },
      });

      await tx.outboxEvent.create({
        data: {
          aggregateType: 'PRESCRIPTION',
          aggregateId: prescription.id,
          eventType: 'PRESCRIPTION_ISSUED',
          payload: {
            prescriptionId: prescription.id,
            appointmentId,
            patientId: apptRow.patient_id,
            version: 1,
          },
        },
      });

      return prescription;
    });
  }

  /**
   * Updates an existing prescription by appending a new immutable version.
   * Invariant: Past versions are never mutated or deleted.
   */
  async updatePrescription(
    appointmentId: string,
    doctorUserId: string,
    data: PrescriptionPayload,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // Lock prescription row FOR UPDATE
      const [lockedRx] = await tx.$queryRaw<
        Array<{
          id: string;
          appointment_id: string;
          doctor_id: string;
          patient_id: string;
          current_version: number;
          doctor_user_id: string;
        }>
      >`
        SELECT p.id, p.appointment_id, p.doctor_id, p.patient_id, p.current_version, d.user_id as doctor_user_id
        FROM prescriptions p
        JOIN doctors d ON d.id = p.doctor_id
        WHERE p.appointment_id = ${appointmentId}::uuid
        FOR UPDATE
      `;

      if (!lockedRx) {
        throw new NotFoundException('No existing prescription found to update');
      }

      if (lockedRx.doctor_user_id !== doctorUserId) {
        throw new ForbiddenException('Only the assigned doctor can update the prescription');
      }

      const newVersion = lockedRx.current_version + 1;

      const updated = await tx.prescription.update({
        where: { id: lockedRx.id },
        data: {
          diagnosis: data.diagnosis,
          medicines: data.medicines as any,
          advice: data.advice,
          currentVersion: newVersion,
        },
      });

      await tx.prescriptionVersion.create({
        data: {
          prescriptionId: lockedRx.id,
          version: newVersion,
          diagnosis: data.diagnosis,
          medicines: data.medicines as any,
          advice: data.advice,
        },
      });

      await this.auditService.log({
        userId: doctorUserId,
        action: 'UPDATE_PRESCRIPTION_VERSION',
        resource: 'PRESCRIPTION',
        resourceId: lockedRx.id,
        details: { newVersion, previousVersion: lockedRx.current_version },
      });

      await tx.notification.create({
        data: {
          userId: lockedRx.patient_id,
          type: 'PRESCRIPTION_UPDATED',
          title: 'Prescription Updated',
          body: `Your prescription for consultation ${appointmentId.slice(0, 8)} has been updated to Version ${newVersion}.`,
          metadata: {
            appointmentId,
            prescriptionId: lockedRx.id,
            version: newVersion,
          },
        },
      });

      await tx.outboxEvent.create({
        data: {
          aggregateType: 'PRESCRIPTION',
          aggregateId: lockedRx.id,
          eventType: 'PRESCRIPTION_UPDATED',
          payload: {
            prescriptionId: lockedRx.id,
            appointmentId,
            patientId: lockedRx.patient_id,
            version: newVersion,
          },
        },
      });

      return updated;
    });
  }

  /**
   * Retrieves prescription and all versions.
   * Enforces:
   * 1. Only patient, doctor, or admin can read.
   * 2. Read triggers an immutable PHI read audit log.
   */
  async getPrescription(appointmentId: string, readerUserId: string) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        doctor: true,
        patient: true,
        prescription: {
          include: {
            versions: { orderBy: { version: 'desc' } },
          },
        },
      },
    });

    if (!appointment) throw new NotFoundException('Appointment not found');

    const isPatient = appointment.patientId === readerUserId;
    const isDoctor = appointment.doctor.userId === readerUserId;

    if (!isPatient && !isDoctor) {
      throw new ForbiddenException('Access denied: Unauthorized prescription access');
    }

    if (!appointment.prescription) {
      throw new NotFoundException('No prescription found for this appointment');
    }

    // Record immutable PHI read audit log
    await this.auditService.logPhiRead(
      readerUserId,
      appointment.patientId,
      'PRESCRIPTION',
      appointment.prescription.id,
    );


    return appointment.prescription;
  }
}
