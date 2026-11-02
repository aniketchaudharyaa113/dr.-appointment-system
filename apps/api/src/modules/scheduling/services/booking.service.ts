import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
import { PrismaService } from '../../platform/database/prisma.service';
import { RedisService } from '../../platform/redis/redis.service';
import { SlotService } from './slot.service';
import { AuditService } from '../../platform/audit/audit.service';
import { ConsultationMode } from '@medibook/shared';

@Injectable()
export class BookingService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(SlotService) private readonly slotService: SlotService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /**
   * Acquire a 10-minute slot hold lease in Redis
   */
  async holdSlot(
    doctorId: string,
    slotTimeIso: string,
    patientId: string,
  ): Promise<{ holdToken: string; expiresAt: string; slotTime: string }> {
    const slotDate = new Date(slotTimeIso);
    if (isNaN(slotDate.getTime())) {
      throw new BadRequestException('Invalid slotTime format');
    }

    // 1. Verify doctor verified
    const doctor = await this.prisma.doctor.findUnique({
      where: { id: doctorId },
    });
    if (!doctor || !doctor.isVerified) {
      throw new BadRequestException('Doctor not found or not verified');
    }

    // 2. Validate alignment to slot duration grid
    const alignment = await this.slotService.validateSlotAlignment(
      doctorId,
      slotDate,
    );
    if (!alignment.isValid) {
      throw new BadRequestException(alignment.reason);
    }

    // 3. Check database active bookings
    const existing = await this.prisma.appointment.findFirst({
      where: {
        doctorId,
        slotTime: slotDate,
        status: { in: ['PENDING_PAYMENT', 'CONFIRMED'] },
      },
    });
    if (existing) {
      throw new ConflictException('Slot is already booked');
    }

    // 4. Acquire Redis hold lease (10 minutes = 600s)
    const acquired = await this.redis.acquireSlotHold(
      doctorId,
      slotDate.toISOString(),
      patientId,
      600,
    );

    if (!acquired) {
      const heldBy = await this.redis.getSlotHold(doctorId, slotDate.toISOString());
      if (heldBy !== patientId) {
        throw new ConflictException('Slot is currently held by another patient');
      }
    }

    const expiresAt = new Date(Date.now() + 600 * 1000).toISOString();
    const holdToken = `hold:${doctorId}:${slotDate.toISOString()}:${patientId}`;

    return {
      holdToken,
      expiresAt,
      slotTime: slotDate.toISOString(),
    };
  }

  /**
   * Generates atomic sequential daily reference token MB-YYYYMMDD-NNN
   */
  async generateDailyReferenceToken(
    doctorId: string,
    bookingDate: Date,
    tx: any,
  ): Promise<string> {
    const dateStr = bookingDate.toISOString().split('T')[0]; // YYYY-MM-DD
    const dateCompact = dateStr.replace(/-/g, ''); // YYYYMMDD
    const dateOnly = new Date(`${dateStr}T00:00:00.000Z`);

    // Atomic counter upsert with row-lock
    const counterRes = await tx.$queryRaw<Array<{ last_seq: number }>>`
      INSERT INTO doctor_daily_counters (doctor_id, booking_date, last_seq)
      VALUES (${doctorId}::uuid, ${dateOnly}::date, 1)
      ON CONFLICT (doctor_id, booking_date)
      DO UPDATE SET last_seq = doctor_daily_counters.last_seq + 1
      RETURNING last_seq;
    `;

    const seq = counterRes[0].last_seq;
    const seqPadded = String(seq).padStart(3, '0');
    return `MB-${dateCompact}-${seqPadded}`;
  }

  /**
   * Books an appointment with atomic daily sequence and partial unique index protection
   */
  async bookAppointment(
    doctorId: string,
    slotTimeIso: string,
    patientId: string,
    consultationMode: ConsultationMode = 'VIDEO',
    notes?: string,
    _idempotencyKey?: string,
  ) {
    const slotDate = new Date(slotTimeIso);

    // 1. Verify doctor verified
    const doctor = await this.prisma.doctor.findUnique({
      where: { id: doctorId },
    });
    if (!doctor || !doctor.isVerified) {
      throw new BadRequestException('Doctor not found or not verified');
    }

    // 2. Validate alignment
    const alignment = await this.slotService.validateSlotAlignment(
      doctorId,
      slotDate,
    );
    if (!alignment.isValid) {
      throw new BadRequestException(alignment.reason);
    }

    try {
      const appointment = await this.prisma.$transaction(async (tx) => {
        // Generate atomic booking reference token (MB-YYYYMMDD-NNN)
        const bookingRef = await this.generateDailyReferenceToken(
          doctorId,
          slotDate,
          tx,
        );

        // Insert appointment (Guarded by Partial Unique Index idx_appointments_doctor_slot_active)
        const appt = await tx.appointment.create({
          data: {
            doctorId,
            patientId,
            slotTime: slotDate,
            consultationMode,
            status: 'CONFIRMED',
            bookingRef,
            notes,
          },
        });

        // Initialize consultation session
        await tx.consultationSession.create({
          data: {
            appointmentId: appt.id,
            roomName: `consult-${appt.id}`,
            status: 'SCHEDULED',
          },
        });

        // Transactional Outbox Event
        await tx.outboxEvent.create({
          data: {
            aggregateType: 'APPOINTMENT',
            aggregateId: appt.id,
            eventType: 'AppointmentConfirmed',
            payload: {
              appointmentId: appt.id,
              bookingRef,
              doctorId,
              patientId,
              slotTime: slotDate.toISOString(),
            },
          },
        });

        return appt;
      });

      // Release Redis hold upon successful booking
      await this.redis.releaseSlotHold(doctorId, slotDate.toISOString());

      await this.audit.log({
        userId: patientId,
        action: 'APPOINTMENT_BOOKED',
        resource: 'APPOINTMENT',
        resourceId: appointment.id,
        details: {
          bookingRef: appointment.bookingRef,
          doctorId,
          slotTime: slotDate.toISOString(),
        },
      });

      return appointment;
    } catch (error: any) {
      // Catch PostgreSQL partial unique index conflict: P2002 in Prisma
      if (
        error.code === 'P2002' ||
        error.message?.includes('idx_appointments_doctor_slot_active') ||
        error.message?.includes('Unique constraint failed')
      ) {
        throw new ConflictException(
          'Slot is already booked by another patient (Concurrency Conflict)',
        );
      }
      throw error;
    }
  }

  /**
   * Cancel an appointment. Cancelled slots are immediately rebookable!
   */
  async cancelAppointment(
    appointmentId: string,
    userId: string,
    reason = 'Patient requested cancellation',
  ) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: { doctor: true },
    });

    if (!appointment) {
      throw new NotFoundException('Appointment not found');
    }

    if (
      appointment.patientId !== userId &&
      appointment.doctor.userId !== userId
    ) {
      throw new ForbiddenException('Not authorized to cancel this appointment');
    }

    if (
      appointment.status === 'CANCELLED' ||
      appointment.status === 'COMPLETED'
    ) {
      throw new BadRequestException(
        `Cannot cancel an appointment that is already ${appointment.status}`,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const cancelled = await tx.appointment.update({
        where: { id: appointmentId },
        data: {
          status: 'CANCELLED',
          cancellationReason: reason,
        },
      });

      // Transactional Outbox Event for cancellation and refund
      await tx.outboxEvent.create({
        data: {
          aggregateType: 'APPOINTMENT',
          aggregateId: appointmentId,
          eventType: 'AppointmentCancelled',
          payload: {
            appointmentId,
            doctorId: appointment.doctorId,
            patientId: appointment.patientId,
            slotTime: appointment.slotTime.toISOString(),
            reason,
          },
        },
      });

      return cancelled;
    });

    await this.audit.log({
      userId,
      action: 'APPOINTMENT_CANCELLED',
      resource: 'APPOINTMENT',
      resourceId: appointmentId,
      details: { reason },
    });

    return updated;
  }
}
