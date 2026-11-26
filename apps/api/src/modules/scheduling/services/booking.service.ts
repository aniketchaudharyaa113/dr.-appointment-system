import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Inject,
  Logger,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../platform/database/prisma.service';
import { RedisService } from '../../platform/redis/redis.service';
import { SlotService } from './slot.service';
import { AuditService } from '../../platform/audit/audit.service';
import { RealtimeService } from '../../platform/realtime/realtime.service';
import { RefundPolicyService } from '../../payments/services/refund-policy.service';
import { assertAppointmentTransition } from '../appointment-state';
import { ConsultationMode, MyAppointmentsQuery } from '@medibook/shared';
import { getIstDateCompact, getIstDateString } from '../../../common/utils/ist-time';

@Injectable()
export class BookingService {
  private readonly logger = new Logger(BookingService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(SlotService) private readonly slotService: SlotService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(RealtimeService) private readonly realtime: RealtimeService,
    @Inject(RefundPolicyService) private readonly refundPolicy: RefundPolicyService,
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

    // P1-8 (a): Enforce max 1 active hold per patient in Redis
    const activeHold = await this.redis.getActivePatientHold(patientId);
    if (activeHold) {
      if (activeHold.doctorId !== doctorId || activeHold.slotTimeIso !== normalizedIso) {
        await this.redis.releaseSlotHold(
          activeHold.doctorId,
          activeHold.slotTimeIso,
          activeHold.token,
          patientId,
        );
      }
    }

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
      await this.redis.setActivePatientHold(
        patientId,
        { doctorId, slotTimeIso: normalizedIso, token: held.token },
        ttlSeconds,
      );
      return {
        holdToken: held.token,
        expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
        slotTime: normalizedIso,
      };
    }

    await this.redis.setActivePatientHold(
      patientId,
      { doctorId, slotTimeIso: normalizedIso, token },
      ttlSeconds,
    );

    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    return {
      holdToken: token,
      expiresAt,
      slotTime: normalizedIso,
    };
  }

  /**
   * Immediately releases a patient's active slot hold lease in Redis (P1-8)
   */
  async releaseHold(
    patientId: string,
    doctorId?: string,
    slotTimeIso?: string,
  ): Promise<{ released: boolean }> {
    const activeHold = await this.redis.getActivePatientHold(patientId);
    const targetDocId = doctorId || activeHold?.doctorId;
    const targetSlot = slotTimeIso ? new Date(slotTimeIso).toISOString() : activeHold?.slotTimeIso;
    const targetToken = activeHold?.token;

    if (targetDocId && targetSlot) {
      await this.redis.releaseSlotHold(targetDocId, targetSlot, targetToken, patientId);
    }
    await this.redis.clearActivePatientHold(patientId);
    return { released: true };
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

      // 5. Post-commit side effects: best-effort with logging so Redis/Audit errors don't fail a created appointment
      try {
        await this.redis.releaseSlotHold(
          doctorId,
          normalizedIso,
          holdToken,
          patientId,
        );
        await this.redis.clearActivePatientHold(patientId);
        await this.redis.getClient().del(`cache:next_slot:${doctorId}`);
      } catch (err: any) {
        this.logger.warn(`Failed to clean up Redis slot holds after booking ${appointment.id}: ${err.message}`);
      }

      try {
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
      } catch (err: any) {
        this.logger.warn(`Failed to record audit log for appointment ${appointment.id}: ${err.message}`);
      }

      if (idemKey) {
        try {
          await this.redis.setIdempotency(idemKey, appointment, 86400);
        } catch (err: any) {
          this.logger.warn(`Failed to set idempotency record for ${idemKey}: ${err.message}`);
        }
      }

      try {
        this.realtime.emitToUser(patientId, 'booking_updated', {
          appointmentId: appointment.id,
          bookingRef: appointment.bookingRef,
          status: appointment.status,
        });
      } catch (err: any) {
        this.logger.warn(`Failed to emit realtime update for appointment ${appointment.id}: ${err.message}`);
      }

      return appointment;
    } catch (error: any) {
      if (error.code === 'P2002') {
        const target = Array.isArray(error.meta?.target)
          ? error.meta.target.join(',')
          : String(error.meta?.target || '');
        if (
          target.includes('slot') ||
          target.includes('doctor') ||
          target.includes('idx_appointments_doctor_slot_active') ||
          error.message?.includes('idx_appointments_doctor_slot_active')
        ) {
          throw new ConflictException(
            'Slot is already booked by another patient (Concurrency Conflict)',
          );
        }
        if (target.includes('bookingRef') || target.includes('booking_ref')) {
          throw new ConflictException(
            'Booking reference generation conflict. Please retry your booking request.',
          );
        }
        throw new ConflictException(
          `Unique constraint violation on ${target || 'unknown target'}`,
        );
      }
      if (error.message?.includes('idx_appointments_doctor_slot_active')) {
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

        await tx.outboxEvent.create({
          data: {
            aggregateType: 'APPOINTMENT',
            aggregateId: appt.id,
            eventType: 'AppointmentSlotFreed',
            payload: {
              appointmentId: appt.id,
              doctorId: appt.doctor_id,
              slotTime: new Date(appt.slot_time).toISOString(),
            },
          },
        });

        releasedCount++;
      }

      for (const appt of candidates) {
        await this.redis.getClient().del(`cache:next_slot:${appt.doctor_id}`);
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

    const updated = await this.prisma.$transaction(async (tx) => {
      const lockedAppts = await tx.$queryRaw<
        Array<{ id: string; status: string; slot_time: Date; doctor_id: string; patient_id: string }>
      >`
        SELECT id, status, slot_time, doctor_id, patient_id
        FROM appointments
        WHERE id = ${appointmentId}::uuid
        FOR UPDATE
      `;
      const lockedAppt = lockedAppts[0];
      if (!lockedAppt) {
        throw new NotFoundException('Appointment not found');
      }

      if (!['PENDING_PAYMENT', 'CONFIRMED', 'HELD'].includes(lockedAppt.status)) {
        throw new BadRequestException(
          `Cannot cancel an appointment in status ${lockedAppt.status}`,
        );
      }

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

      await tx.outboxEvent.create({
        data: {
          aggregateType: 'APPOINTMENT',
          aggregateId: appointmentId,
          eventType: 'AppointmentSlotFreed',
          payload: {
            appointmentId,
            doctorId: appointment.doctorId,
            slotTime: appointment.slotTime.toISOString(),
          },
        },
      });

      // If payment was already CAPTURED, create Refund + reverse ledger + enqueue refund dispatch in SAME tx
      const paymentRows = await tx.$queryRaw<
        Array<{ id: string; status: string; amount_paise: number; provider_payment_id: string | null }>
      >`
        SELECT id, status, amount_paise, provider_payment_id
        FROM payments
        WHERE appointment_id = ${appointmentId}::uuid
        FOR UPDATE
      `;
      const payment = paymentRows[0];
      if (payment && payment.status === 'CAPTURED') {
        const initiatedBy =
          userRole === 'ADMIN'
            ? 'ADMIN'
            : appointment.doctor.userId === userId
              ? 'DOCTOR'
              : 'PATIENT';
        const { refundAmountPaise } = this.refundPolicy.calculateRefundAmountPaise({
          amountPaise: payment.amount_paise,
          slotTime: new Date(lockedAppt.slot_time),
          initiatedBy,
        });
        await this.refundPolicy.recordRefundInTx(tx, {
          paymentId: payment.id,
          appointmentId,
          providerPaymentId: payment.provider_payment_id,
          refundAmountPaise,
          reason,
        });
      }

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
   * Lists appointments owned by the authenticated patient or doctor with cursor pagination & status/date filters.
   */
  async getMyAppointments(
    userId: string,
    role: string,
    query: MyAppointmentsQuery = { limit: 20 },
  ) {
    const whereClause: any =
      role === 'DOCTOR'
        ? { doctor: { userId } }
        : role === 'ADMIN'
          ? {}
          : { patientId: userId };

    if (query.status) {
      whereClause.status = query.status;
    }

    if (query.mode) {
      whereClause.consultationMode = query.mode;
    }

    if (query.fromDate || query.toDate) {
      whereClause.slotTime = {};
      if (query.fromDate) {
        whereClause.slotTime.gte = new Date(`${query.fromDate}T00:00:00.000Z`);
      }
      if (query.toDate) {
        whereClause.slotTime.lte = new Date(`${query.toDate}T23:59:59.999Z`);
      }
    }

    const limit = query.limit || 20;

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
        review: {
          select: { id: true, rating: true, comment: true },
        },
      },
      orderBy: [{ slotTime: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor
        ? {
            cursor: { id: query.cursor },
            skip: 1,
          }
        : {}),
    });

    const hasMore = appointments.length > limit;
    const items = hasMore ? appointments.slice(0, limit) : appointments;
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    const formatted = items.map((a) => ({
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
      review: a.review,
    }));

    return {
      items: formatted,
      nextCursor,
    };
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

  /**
   * Periodic job: marks CONFIRMED appointments without an active/ended session
   * past slotTime + 30 minutes as NO_SHOW.
   */
  async markNoShowAppointments(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - 30 * 60 * 1000);
    const candidateRows = await this.prisma.appointment.findMany({
      where: {
        status: 'CONFIRMED',
        slotTime: { lt: cutoff },
        OR: [
          { consultation: null },
          { consultation: { status: { in: ['SCHEDULED', 'WAITING'] } } },
        ],
      },
      select: {
        id: true,
        patientId: true,
        doctorId: true,
        slotTime: true,
      },
    });

    let count = 0;
    for (const appt of candidateRows) {
      await this.prisma.$transaction(async (tx) => {
        const locked = await tx.appointment.findUnique({
          where: { id: appt.id },
          select: { status: true },
        });
        if (locked?.status !== 'CONFIRMED') return;

        assertAppointmentTransition('CONFIRMED', 'NO_SHOW');
        await tx.appointment.update({
          where: { id: appt.id },
          data: { status: 'NO_SHOW' },
        });

        await tx.outboxEvent.create({
          data: {
            aggregateType: 'APPOINTMENT',
            aggregateId: appt.id,
            eventType: 'APPOINTMENT_NO_SHOW',
            payload: {
              appointmentId: appt.id,
              patientId: appt.patientId,
              doctorId: appt.doctorId,
              slotTime: appt.slotTime.toISOString(),
            },
          },
        });
        count++;
      });
    }
    return count;
  }

  /**
   * Submits a patient review and rating for a completed appointment.
   * Updates denormalized Doctor ratingAvg and ratingCount columns atomically.
   */
  async reviewAppointment(
    appointmentId: string,
    patientId: string,
    rating: number,
    comment?: string,
  ) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: { review: true },
    });

    if (!appointment) {
      throw new NotFoundException('Appointment not found');
    }

    if (appointment.patientId !== patientId) {
      throw new ForbiddenException('Only the patient of this appointment can leave a review');
    }

    if (appointment.status !== 'COMPLETED') {
      throw new BadRequestException('Only completed consultations can be reviewed');
    }

    if (appointment.review) {
      throw new ConflictException('This appointment has already been reviewed');
    }

    return this.prisma.$transaction(async (tx) => {
      const review = await tx.review.create({
        data: {
          appointmentId,
          doctorId: appointment.doctorId,
          patientId,
          rating,
          comment,
        },
      });

      const agg = await tx.review.aggregate({
        where: { doctorId: appointment.doctorId },
        _avg: { rating: true },
        _count: { rating: true },
      });

      await tx.doctor.update({
        where: { id: appointment.doctorId },
        data: {
          ratingAvg: agg._avg.rating || 0,
          ratingCount: agg._count.rating || 0,
        },
      });

      return review;
    });
  }
}
