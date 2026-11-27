import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { PrismaService } from '../../platform/database/prisma.service';
import { RealtimeService } from '../../platform/realtime/realtime.service';

export interface RecordVitalsDto {
  systolicBp?: number;
  diastolicBp?: number;
  heartRate?: number;
  spO2?: number;
  temperatureF?: number;
  weightKg?: number;
  bloodGlucose?: number;
}

export interface CreateLabOrderDto {
  testName: string;
  testCode: string;
  urgency?: 'ROUTINE' | 'URGENT' | 'STAT';
  instructions?: string;
}

export interface UpdateLabResultsDto {
  status?: 'SAMPLE_COLLECTED' | 'PROCESSING' | 'COMPLETED' | 'CANCELLED';
  results?: string | Record<string, any>;
  resultsJson?: Record<string, any>;
  resultNotes?: string;
}

@Injectable()
export class ClinicalService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RealtimeService) private readonly realtime: RealtimeService,
  ) {}

  /**
   * Patient or Doctor records vitals during/before a consultation
   */
  async recordVitals(appointmentId: string, userId: string, dto: RecordVitalsDto) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: { doctor: true, consultation: true },
    });

    if (!appointment) {
      throw new NotFoundException('Appointment not found');
    }

    if (
      appointment.status !== 'CONFIRMED' &&
      appointment.status !== 'IN_PROGRESS' &&
      appointment.status !== 'COMPLETED'
    ) {
      throw new BadRequestException(
        `Cannot record vitals for appointment in status ${appointment.status}`,
      );
    }

    const isPatient = appointment.patientId === userId;
    const isDoctor = appointment.doctor.userId === userId;

    if (!isPatient && !isDoctor) {
      throw new ForbiddenException('Only the patient or doctor can record vitals for this appointment');
    }

    if (appointment.status === 'COMPLETED') {
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      const completedTime =
        appointment.consultation?.endedAt?.getTime() ||
        appointment.updatedAt.getTime();
      if (Date.now() - completedTime > sevenDaysMs) {
        throw new BadRequestException(
          'Follow-up vitals recording window has closed (limited to 7 days post-consultation)',
        );
      }
    }

    const vitals = await this.prisma.patientVitals.create({
      data: {
        appointmentId,
        patientId: appointment.patientId,
        systolicBp: dto.systolicBp,
        diastolicBp: dto.diastolicBp,
        heartRate: dto.heartRate,
        spO2: dto.spO2 !== undefined ? dto.spO2 : undefined,
        temperatureF: dto.temperatureF !== undefined ? dto.temperatureF : undefined,
        weightKg: dto.weightKg !== undefined ? dto.weightKg : undefined,
        bloodGlucose: dto.bloodGlucose !== undefined ? dto.bloodGlucose : undefined,
      },
    });

    // Notify consultation room via Realtime WebSocket
    this.realtime.emitToConsultationRoom(appointmentId, 'vitals_updated', {
      appointmentId,
      vitals,
    });

    return vitals;
  }

  /**
   * Retrieves all vitals history for an appointment or patient
   */
  async getVitals(appointmentId: string, userId: string) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: { doctor: true },
    });

    if (!appointment) {
      throw new NotFoundException('Appointment not found');
    }

    const isPatient = appointment.patientId === userId;
    const isDoctor = appointment.doctor.userId === userId;

    if (!isPatient && !isDoctor) {
      throw new ForbiddenException('Unauthorized to view clinical vitals');
    }

    return this.prisma.patientVitals.findMany({
      where: { appointmentId },
      orderBy: { recordedAt: 'desc' },
    });
  }

  /**
   * Doctor creates a diagnostic lab order for an appointment
   */
  async createLabOrder(
    appointmentId: string,
    doctorUserId: string,
    dto: CreateLabOrderDto,
    now: Date = new Date(),
  ) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: { doctor: true, consultation: true },
    });

    if (!appointment) {
      throw new NotFoundException('Appointment not found');
    }

    if (appointment.doctor.userId !== doctorUserId) {
      throw new ForbiddenException('Only the treating doctor can prescribe diagnostic lab tests');
    }

    if (
      appointment.status !== 'CONFIRMED' &&
      appointment.status !== 'IN_PROGRESS' &&
      appointment.status !== 'COMPLETED'
    ) {
      throw new BadRequestException(
        `Cannot create diagnostic lab order for appointment in status ${appointment.status}`,
      );
    }

    const nowMs = now.getTime();
    if (appointment.status === 'CONFIRMED' || appointment.status === 'IN_PROGRESS') {
      const earliestMs = appointment.slotTime.getTime() - 24 * 60 * 60 * 1000;
      const latestMs = appointment.slotTime.getTime() + 7 * 24 * 60 * 60 * 1000;
      if (nowMs < earliestMs) {
        throw new BadRequestException(
          'Diagnostic lab orders cannot be placed more than 24 hours before the consultation slot',
        );
      }
      if (nowMs > latestMs) {
        throw new BadRequestException(
          'Consultation window for ordering diagnostic lab tests has closed',
        );
      }
    } else if (appointment.status === 'COMPLETED') {
      const completedTime =
        appointment.consultation?.endedAt?.getTime() ||
        appointment.updatedAt.getTime();
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      if (nowMs - completedTime > sevenDaysMs) {
        throw new BadRequestException(
          'Follow-up lab ordering window has closed (limited to 7 days post-consultation)',
        );
      }
    }

    const labOrder = await this.prisma.labOrder.create({
      data: {
        appointmentId,
        doctorId: appointment.doctorId,
        patientId: appointment.patientId,
        testName: dto.testName,
        testCode: dto.testCode,
        urgency: dto.urgency || 'ROUTINE',
        instructions: dto.instructions,
        status: 'ORDERED',
      },
    });

    // Notify patient via realtime
    this.realtime.emitToUser(appointment.patientId, 'lab_order_created', {
      orderId: labOrder.id,
      appointmentId,
      testName: labOrder.testName,
    });

    return labOrder;
  }

  /**
   * Doctor or Patient gets lab orders for an appointment
   */
  async getLabOrders(appointmentId: string, userId: string) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: { doctor: true },
    });

    if (!appointment) {
      throw new NotFoundException('Appointment not found');
    }

    const isPatient = appointment.patientId === userId;
    const isDoctor = appointment.doctor.userId === userId;

    if (!isPatient && !isDoctor) {
      throw new ForbiddenException('Unauthorized to access lab orders');
    }

    return this.prisma.labOrder.findMany({
      where: { appointmentId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Updates diagnostic lab order results (Ordering doctor only)
   */
  async updateLabResults(orderId: string, userId: string, dto: UpdateLabResultsDto) {
    const order = await this.prisma.labOrder.findUnique({
      where: { id: orderId },
      include: { doctor: true },
    });

    if (!order) {
      throw new NotFoundException('Lab order not found');
    }

    if (order.doctor.userId !== userId) {
      throw new ForbiddenException('Only the ordering physician can record laboratory results');
    }

    if (order.status === 'COMPLETED' || order.status === 'CANCELLED') {
      throw new BadRequestException(
        `Cannot modify diagnostic lab order in terminal status ${order.status}`,
      );
    }

    const allowedTransitions: Record<string, string[]> = {
      ORDERED: ['ORDERED', 'SAMPLE_COLLECTED', 'PROCESSING', 'COMPLETED', 'CANCELLED'],
      SAMPLE_COLLECTED: ['SAMPLE_COLLECTED', 'PROCESSING', 'COMPLETED', 'CANCELLED'],
      PROCESSING: ['PROCESSING', 'COMPLETED', 'CANCELLED'],
    };

    let finalResultsJson: any = dto.resultsJson;
    if (dto.results !== undefined) {
      if (typeof dto.results === 'string') {
        finalResultsJson = { summary: dto.results };
      } else {
        finalResultsJson = dto.results;
      }
    }

    const nextStatus = dto.status ?? order.status;
    if (!(allowedTransitions[order.status] ?? []).includes(nextStatus)) {
      throw new BadRequestException(
        `Invalid lab order status transition from ${order.status} to ${nextStatus}`,
      );
    }

    const completedAt = nextStatus === 'COMPLETED' ? (order.completedAt || new Date()) : undefined;

    return this.prisma.labOrder.update({
      where: { id: orderId },
      data: {
        status: nextStatus,
        resultsJson: finalResultsJson !== undefined ? finalResultsJson : undefined,
        resultNotes: dto.resultNotes !== undefined ? dto.resultNotes : undefined,
        completedAt,
      },
    });
  }

  /**
   * Aggregates a patient's longitudinal Health Passport (vitals, lab orders, prescriptions)
   */
  async getHealthPassport(patientId: string) {
    const [patient, vitals, labOrders, prescriptions] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: patientId },
        select: { id: true, name: true, email: true, phone: true },
      }),
      this.prisma.patientVitals.findMany({
        where: { patientId },
        orderBy: { recordedAt: 'desc' },
        take: 10,
      }),
      this.prisma.labOrder.findMany({
        where: { patientId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: {
          doctor: {
            include: { user: { select: { name: true } } },
          },
        },
      }),
      this.prisma.prescription.findMany({
        where: { patientId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: {
          doctor: {
            include: { user: { select: { name: true } } },
          },
        },
      }),
    ]);

    return {
      patient,
      latestVitals: vitals[0] || null,
      vitalsHistory: vitals,
      labOrders: labOrders.map((o) => ({
        id: o.id,
        testName: o.testName,
        testCode: o.testCode,
        urgency: o.urgency,
        status: o.status,
        instructions: o.instructions,
        resultsJson: o.resultsJson,
        resultNotes: o.resultNotes,
        completedAt: o.completedAt ? o.completedAt.toISOString() : null,
        doctorName: o.doctor.user.name,
        createdAt: o.createdAt.toISOString(),
      })),
      prescriptions: prescriptions.map((p) => ({
        id: p.id,
        appointmentId: p.appointmentId,
        diagnosis: p.diagnosis,
        medicines: p.medicines,
        advice: p.advice,
        currentVersion: p.currentVersion,
        doctorName: p.doctor.user.name,
        createdAt: p.createdAt.toISOString(),
      })),
    };
  }
}
