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
    private readonly auditService: AuditService,
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
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: { doctor: true, prescription: true },
    });

    if (!appointment) {
      throw new NotFoundException(`Appointment ${appointmentId} not found`);
    }

    if (appointment.doctor.userId !== doctorUserId) {
      throw new ForbiddenException(
        'Only the assigned doctor can issue a prescription for this appointment',
      );
    }

    if (appointment.status !== 'COMPLETED') {
      throw new BadRequestException(
        `Cannot issue prescription for appointment in status ${appointment.status}. Appointment must be COMPLETED.`,
      );
    }

    if (appointment.prescription) {
      throw new BadRequestException(
        'A prescription already exists for this appointment. Use updatePrescription to create a new immutable version.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const prescription = await tx.prescription.create({
        data: {
          appointmentId,
          doctorId: appointment.doctorId,
          patientId: appointment.patientId,
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
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: { doctor: true, prescription: true },
    });

    if (!appointment) throw new NotFoundException('Appointment not found');
    if (appointment.doctor.userId !== doctorUserId) {
      throw new ForbiddenException('Only the assigned doctor can update the prescription');
    }

    const prescription = appointment.prescription;
    if (!prescription) {
      throw new NotFoundException('No existing prescription found to update');
    }

    const newVersion = prescription.currentVersion + 1;

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.prescription.update({
        where: { id: prescription.id },
        data: {
          diagnosis: data.diagnosis,
          medicines: data.medicines as any,
          advice: data.advice,
          currentVersion: newVersion,
        },
      });

      await tx.prescriptionVersion.create({
        data: {
          prescriptionId: prescription.id,
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
        resourceId: prescription.id,
        details: { newVersion, previousVersion: prescription.currentVersion },
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
