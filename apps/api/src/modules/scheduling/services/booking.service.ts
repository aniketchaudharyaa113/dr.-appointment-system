import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../platform/database/prisma.service';
import { RedisService } from '../../platform/redis/redis.service';
import { SlotService } from './slot.service';
import { AuditService } from '../../platform/audit/audit.service';
import { ConsultationMode } from '@medibook/shared';
import { getIstDateCompact, getIstDateString } from '../../../common/utils/ist-time';

@Injectable()
export class BookingService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(SlotService) private readonly slotService: SlotService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /**
   * Acquire a 10-minute slot hold lease in Redis:
   * SET hold:{doctor}:{slot} {token}:{patient} NX EX 600
   */
  async holdSlot(
    doctorId: string,
    slotTimeIso: string,
    patientId: string,
    ttlSeconds = 600,
  ): Promise<{ holdToken: string; expiresAt: string; slotTime: string }> {
    const slotDate = new Date(slotTimeIso);
    if (isNaN(slotDate.getTime())) {
      throw new BadRequestException('Invalid slotTime format');
    }
    const normalizedIso = slotDate.toISOString();

    const doctor = await this.prisma.doctor.findUnique({
      where: { id: doctorId },
    });
    if (!doctor || !doctor.isVerified) {
      throw new BadRequestException('Doctor not found or not verified');
    }

    const alignment = await this.slotService.validateSlotAlignment(
      doctorId,
      slotDate,
    );
    if (!alignment.isValid) {
      if (alignment.reason === 'Slot is already booked') {
        throw new ConflictException(alignment.reason);
      }
      throw new BadRequestException(alignment.reason);
    }

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

    const token = randomBytes(24).toString('hex');
    const acquired = await this.redis.acquireSlotHold(
      doctorId,
      normalizedIso,
      patientId,
      token,
      ttlSeconds,
    );

    if (!acquired) {
      const held = await this.redis.getSlotHold(doctorId, normalizedIso);
      if (!held || held.patientId !== patientId) {
        throw new ConflictException('Slot is currently held by another patient');
      }
      await this.redis.refreshSlotHoldTtl(
        doctorId,
        normalizedIso,
        held.token,
        patientId,
        ttlSeconds,
      );
      return {
        holdToken: held.token,
        expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
        slotTime: normalizedIso,
      };
    }

    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    return {
      holdToken: token,
      expiresAt,
      slotTime: normalizedIso,
    };
  }

  /**
   * Generates atomic sequential daily reference token MB-YYYYMMDD-NNN
   * keyed on the Asia/Kolkata wall-clock date.
   */
  async generateDailyReferenceToken(
    doctorId: string,
    bookingDate: Date,
    tx: any,
  ): Promise<string> {
    const dateStr = getIstDateString(bookingDate); // YYYY-MM-DD in Asia/Kolkata
    const dateCompact = getIstDateCompact(bookingDate); // YYYYMMDD in Asia/Kolkata
    const dateOnly = new Date(`${dateStr}T00:00:00.000Z`);

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
   * Books an appointment in PENDING_PAYMENT state after verifying the unguessable Redis hold token
   * and honouring a 24h Redis idempotency key.
   */
  async bookAppointment(
    doctorId: string,
    slotTimeIso: string,
    patientId: string,
    holdToken: string,
    consultationMode: ConsultationMode = 'VIDEO',
    notes?: string,
    idempotencyKey?: string,
  ) {
    const slotDate = new Date(slotTimeIso);
    if (isNaN(slotDate.getTime())) {
      throw new BadRequestException('Invalid slotTime format');
    }
    const normalizedIso = slotDate.toISOString();

    const idemKey = idempotencyKey
      ? `book:${patientId}:${idempotencyKey}`
      : undefined;

    if (idemKey) {
      const cached = await this.redis.getIdempotency<any>(idemKey);
      if (cached) {
        return cached;
      }
      const lockAcquired = await this.redis.acquireIdempotencyLock(idemKey, 15);
      if (!lockAcquired) {
        await new Promise((r) => setTimeout(r, 150));
        const retried = await this.redis.getIdempotency<any>(idemKey);
        if (retried) return retried;
        throw new ConflictException('Duplicate booking request already in flight');
      }
    }

    try {
      // 1. Verify Redis hold token ownership BEFORE entering DB transaction
      const held = await this.redis.getSlotHold(doctorId, normalizedIso);
      if (!held) {
        throw new ConflictException(
          'Slot hold has expired or does not exist. Please select a slot again.',
        );
      }
      if (held.patientId !== patientId || held.token !== holdToken) {
        throw new ForbiddenException(
          'Slot hold is not owned by this patient or hold token is invalid',
        );
      }

      // 2. Verify doctor is verified
      const doctor = await this.prisma.doctor.findUnique({
        where: { id: doctorId },
      });
      if (!doctor || !doctor.isVerified) {
        throw new BadRequestException('Doctor not found or not verified');
      }

      // 3. Validate slot alignment in Asia/Kolkata
      const alignment = await this.slotService.validateSlotAlignment(
        doctorId,
        slotDate,
      );
      if (!alignment.isValid) {
        if (alignment.reason === 'Slot is already booked') {
          throw new ConflictException(alignment.reason);
        }
        throw new BadRequestException(alignment.reason);
      }

      // 4. Create PENDING_PAYMENT appointment in transaction guarded by partial unique index
      const appointment = await this.prisma.$transaction(async (tx) => {
        const bookingRef = await this.generateDailyReferenceToken(
          doctorId,
          slotDate,
          tx,
        );

        const appt = await tx.appointment.create({
          data: {
            doctorId,
            patientId,
            slotTime: slotDate,
            consultationMode,
            status: 'PENDING_PAYMENT',
            bookingRef,
            notes,
          },
        });

        await tx.consultationSession.create({
          data: {
            appointmentId: appt.id,
            roomName: `consult-${appt.id}`,
            status: 'SCHEDULED',
          },
        });

        await tx.outboxEvent.create({
          data: {
            aggregateType: 'APPOINTMENT',
            aggregateId: appt.id,
            eventType: 'APPOINTMENT_PENDING_PAYMENT',
            payload: {
              appointmentId: appt.id,
              bookingRef,
              doctorId,
              patientId,
              slotTime: normalizedIso,
            },
          },
        });

        return appt;
      });

      // 5. Release Redis hold upon successful creation & invalidate cached next slot
      await this.redis.releaseSlotHold(
        doctorId,
        normalizedIso,
        holdToken,
        patientId,
      );
      await this.redis.getClient().del(`cache:next_slot:${doctorId}`);

      await this.audit.log({
        userId: patientId,
        action: 'APPOINTMENT_CREATED_PENDING_PAYMENT',
        resource: 'APPOINTMENT',
        resourceId: appointment.id,
        details: {
          bookingRef: appointment.bookingRef,
          doctorId,
          slotTime: normalizedIso,
        },
      });

      if (idemKey) {
        await this.redis.setIdempotency(idemKey, appointment, 86400);
      }

      return appointment;
    } catch (error: any) {
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
    } finally {
      if (idemKey) {
        await this.redis.releaseIdempotencyLock(idemKey);
      }
    }
  }

  /**
   * Releases unpaid PENDING_PAYMENT appointments older than expiryMinutes.
   * Returns count of expired appointments released.
   */
  async releaseExpiredPendingAppointments(expiryMinutes = 15): Promise<number> {
    const cutoff = new Date(Date.now() - expiryMinutes * 60 * 1000);

    return this.prisma.$transaction(async (tx) => {
      const candidates = await tx.$queryRaw<
        Array<{ id: string; doctor_id: string; patient_id: string; slot_time: Date }>
      >`
        SELECT a.id, a.doctor_id, a.patient_id, a.slot_time
        FROM appointments a
        LEFT JOIN payments p ON p.appointment_id = a.id
        WHERE a.status = 'PENDING_PAYMENT'
          AND a.created_at < ${cutoff}
          AND (p.id IS NULL OR p.status <> 'CAPTURED')
        FOR UPDATE OF a SKIP LOCKED
      `;

      let releasedCount = 0;

      for (const appt of candidates) {
        await tx.appointment.update({
          where: { id: appt.id },
          data: {
            status: 'CANCELLED',
            cancellationReason: 'Payment window expired',
          },
        });

        await tx.payment.updateMany({
          where: {
            appointmentId: appt.id,
            status: { in: ['INITIATED', 'PENDING'] },
          },
          data: { status: 'FAILED' },
        });

        await tx.outboxEvent.create({
          data: {
            aggregateType: 'APPOINTMENT',
            aggregateId: appt.id,
            eventType: 'APPOINTMENT_EXPIRED',
            payload: {
              appointmentId: appt.id,
              doctorId: appt.doctor_id,
              patientId: appt.patient_id,
              slotTime: new Date(appt.slot_time).toISOString(),
            },
          },
        });

        releasedCount++;
      }

      return releasedCount;
    });
  }

  /**
   * Cancel an appointment. Cancelled slots are immediately rebookable!
   */
  async cancelAppointment(
    appointmentId: string,
    userId: string,
    reason = 'Patient requested cancellation',
    userRole?: string,
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
      appointment.doctor.userId !== userId &&
      userRole !== 'ADMIN'
    ) {
      throw new ForbiddenException('Not authorized to cancel this appointment');
    }

    if (
      appointment.status === 'CANCELLED' ||
      appointment.status === 'COMPLETED' ||
      appointment.status === 'REFUNDED'
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

    await this.redis.getClient().del(`cache:next_slot:${appointment.doctorId}`);

    await this.audit.log({
      userId,
      action: 'APPOINTMENT_CANCELLED',
      resource: 'APPOINTMENT',
      resourceId: appointmentId,
      details: { reason },
    });

    return updated;
  }

  /**
   * Lists appointments owned by the authenticated patient or doctor.
   */
  async getMyAppointments(userId: string, role: string) {
    const whereClause =
      role === 'DOCTOR'
        ? { doctor: { userId } }
        : role === 'ADMIN'
          ? {}
          : { patientId: userId };

    const appointments = await this.prisma.appointment.findMany({
      where: whereClause,
      include: {
        doctor: {
          include: {
            user: { select: { id: true, name: true, email: true } },
          },
        },
        patient: { select: { id: true, name: true, email: true } },
        payment: {
          include: {
            refunds: true,
          },
        },
        prescription: {
          select: { id: true, currentVersion: true, createdAt: true },
        },
        consultation: {
          select: { status: true, roomName: true, patientConsentGiven: true },
        },
      },
      orderBy: { slotTime: 'desc' },
    });

    return appointments.map((a) => ({
      id: a.id,
      bookingRef: a.bookingRef,
      doctorId: a.doctorId,
      doctorName: a.doctor.user.name,
      specialty: a.doctor.specialty,
      clinicName: a.doctor.clinicName,
      clinicAddress: a.doctor.clinicAddress,
      consultationFeePaise: a.doctor.consultationFeePaise,
      patientId: a.patientId,
      patientName: a.patient.name,
      slotTime: a.slotTime.toISOString(),
      consultationMode: a.consultationMode,
      status: a.status,
      cancellationReason: a.cancellationReason,
      createdAt: a.createdAt.toISOString(),
      payment: a.payment
        ? {
            id: a.payment.id,
            status: a.payment.status,
            amountPaise: a.payment.amountPaise,
            provider: a.payment.provider,
            providerOrderId: a.payment.providerOrderId,
            refunds: a.payment.refunds,
          }
        : null,
      prescription: a.prescription,
      consultation: a.consultation,
    }));
  }

  async getAppointmentById(appointmentId: string, userId: string, role: string) {
    const a = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        doctor: {
          include: {
            user: { select: { id: true, name: true, email: true } },
          },
        },
        patient: { select: { id: true, name: true, email: true } },
        payment: {
          include: {
            refunds: true,
          },
        },
        prescription: true,
        consultation: true,
      },
    });

    if (!a) {
      throw new NotFoundException('Appointment not found');
    }

    if (
      a.patientId !== userId &&
      a.doctor.userId !== userId &&
      role !== 'ADMIN'
    ) {
      throw new ForbiddenException('Not authorized to access this appointment');
    }

    return {
      id: a.id,
      bookingRef: a.bookingRef,
      doctorId: a.doctorId,
      doctorName: a.doctor.user.name,
      specialty: a.doctor.specialty,
      qualifications: a.doctor.qualifications,
      licenseNumber: a.doctor.licenseNumber,
      clinicName: a.doctor.clinicName,
      clinicAddress: a.doctor.clinicAddress,
      consultationFeePaise: a.doctor.consultationFeePaise,
      patientId: a.patientId,
      patientName: a.patient.name,
      slotTime: a.slotTime.toISOString(),
      consultationMode: a.consultationMode,
      status: a.status,
      cancellationReason: a.cancellationReason,
      notes: a.notes,
      createdAt: a.createdAt.toISOString(),
      payment: a.payment,
      prescription: a.prescription,
      consultation: a.consultation,
    };
  }
}
