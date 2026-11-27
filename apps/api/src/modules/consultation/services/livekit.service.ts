import {
  Injectable,
  Inject,
  ForbiddenException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { AccessToken } from 'livekit-server-sdk';
import { PrismaService } from '../../platform/database/prisma.service';
import { RealtimeService } from '../../platform/realtime/realtime.service';
import { env } from '../../../common/config/env.schema';
import {
  assertSessionTransition,
  assertAppointmentTransition,
  SessionStatus,
  AppointmentStatus,
} from '../../scheduling/appointment-state';

export interface VideoTokenResult {
  token: string;
  livekitUrl: string;
  roomName: string;
  status: string;
  windowStart: string;
  windowEnd: string;
}

@Injectable()
export class LiveKitService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RealtimeService) private readonly realtime: RealtimeService,
  ) {}

  /**
   * Mints short-lived LiveKit join token.
   * Enforces:
   * 1. Only verified appointment participants (patient or doctor) can join.
   * 2. Join window: [slotTime - 10min, slotTime + 30min]. Outside this window, returns HTTP 400.
   * 3. Patient telemedicine consent must be granted.
   */
  async mintJoinToken(
    appointmentId: string,
    userId: string,
    now: Date = new Date(),
    deviceId?: string,
  ): Promise<VideoTokenResult> {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        doctor: {
          include: {
            user: { select: { id: true, name: true } },
          },
        },
        patient: { select: { id: true, name: true } },
        consultation: true,
      },
    });

    if (!appointment) {
      throw new NotFoundException(`Appointment ${appointmentId} not found`);
    }

    const isPatient = appointment.patientId === userId;
    const isDoctor = appointment.doctor.userId === userId;

    if (!isPatient && !isDoctor) {
      throw new ForbiddenException(
        'Access denied: You are not an authorized participant in this consultation',
      );
    }

    if (appointment.consultationMode !== 'VIDEO') {
      throw new BadRequestException(
        `LiveKit video tokens are only available for VIDEO consultations (this appointment is ${appointment.consultationMode})`,
      );
    }

    if (appointment.status !== 'CONFIRMED' && appointment.status !== 'IN_PROGRESS') {
      throw new BadRequestException(
        `Cannot join video consultation while appointment status is ${appointment.status}`,
      );
    }

    if (appointment.consultation?.status === 'ENDED') {
      throw new BadRequestException('Consultation session has already ended');
    }

    const slotTimeMs = appointment.slotTime.getTime();
    const windowStartMs = slotTimeMs - 10 * 60 * 1000;
    const isOverrunActive =
      appointment.status === 'IN_PROGRESS' ||
      appointment.consultation?.status === 'LIVE';
    const overrunAnchorMs = Math.max(
      slotTimeMs,
      appointment.consultation?.startedAt?.getTime() ?? slotTimeMs,
    );
    // Allow overrun reconnects up to 2 hours while session is LIVE/IN_PROGRESS;
    // unstarted appointments close 30 minutes after slot start.
    const windowEndMs = isOverrunActive
      ? overrunAnchorMs + 120 * 60 * 1000
      : slotTimeMs + 30 * 60 * 1000;
    const nowMs = now.getTime();

    if (nowMs < windowStartMs) {
      throw new BadRequestException(
        `Join window opens 10 minutes before the scheduled slot time (${new Date(
          windowStartMs,
        ).toISOString()})`,
      );
    }

    if (nowMs > windowEndMs) {
      throw new BadRequestException(
        `Join window has expired for this consultation (closed at ${new Date(
          windowEndMs,
        ).toISOString()})`,
      );
    }

    let session = appointment.consultation;
    const roomName = `consult-${appointment.id}`;

    if (!session) {
      session = await this.prisma.consultationSession.create({
        data: {
          appointmentId: appointment.id,
          roomName,
          status: 'SCHEDULED',
          doctorJoinedAt: isDoctor ? now : undefined,
        },
      });
    }

    if (isPatient && !session.patientConsentGiven) {
      throw new BadRequestException(
        'Patient must accept telemedicine consent before joining consultation',
      );
    }

    if (isDoctor && !session.doctorJoinedAt) {
      session = await this.prisma.consultationSession.update({
        where: { id: session.id },
        data: { doctorJoinedAt: now },
      });
    } else if (isPatient && !session.patientJoinedAt) {
      session = await this.prisma.consultationSession.update({
        where: { id: session.id },
        data: { patientJoinedAt: now },
      });
    }

    const rawDocName = appointment.doctor.user?.name?.trim();
    const participantName = isDoctor
      ? rawDocName
        ? /^dr\.?\s/i.test(rawDocName)
          ? rawDocName
          : `Dr. ${rawDocName}`
        : 'Doctor'
      : appointment.patient?.name || 'Patient';

    const deviceSuffix = deviceId || randomBytes(4).toString('hex');
    const identity = `${userId}#${deviceSuffix}`;

    const at = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
      identity,
      name: participantName,
      metadata: JSON.stringify({
        userId,
        role: isDoctor ? 'DOCTOR' : 'PATIENT',
        deviceId: deviceSuffix,
      }),
      ttl: '1h',
    });

    at.addGrant({
      room: session.roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
    });

    const token = await at.toJwt();

    return {
      token,
      livekitUrl: env.LIVEKIT_URL,
      roomName: session.roomName,
      status: session.status,
      windowStart: new Date(windowStartMs).toISOString(),
      windowEnd: new Date(windowEndMs).toISOString(),
    };
  }

  async recordConsent(appointmentId: string, userId: string): Promise<boolean> {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: { consultation: true },
    });

    if (!appointment) {
      throw new NotFoundException(`Appointment ${appointmentId} not found`);
    }

    if (appointment.patientId !== userId) {
      throw new ForbiddenException(
        'Only the appointed patient can grant telemedicine consent',
      );
    }

    if (appointment.status !== 'CONFIRMED' && appointment.status !== 'IN_PROGRESS') {
      throw new BadRequestException(
        `Cannot record telemedicine consent when appointment status is ${appointment.status}`,
      );
    }

    if (appointment.consultation?.status === 'ENDED') {
      throw new BadRequestException('Consultation session has already ended');
    }

    const roomName = `consult-${appointment.id}`;
    const shouldMoveToWaiting =
      !appointment.consultation || appointment.consultation.status === 'SCHEDULED';

    await this.prisma.consultationSession.upsert({
      where: { appointmentId: appointment.id },
      create: {
        appointmentId: appointment.id,
        roomName,
        patientConsentGiven: true,
        consentTimestamp: new Date(),
        status: 'WAITING',
      },
      update: {
        patientConsentGiven: true,
        consentTimestamp: appointment.consultation?.consentTimestamp || new Date(),
        ...(shouldMoveToWaiting ? { status: 'WAITING' } : {}),
      },
    });

    return true;
  }

  async updateSessionStatus(
    appointmentId: string,
    userId: string,
    newStatus: 'WAITING' | 'LIVE' | 'ENDED',
    now: Date = new Date(),
  ) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: { doctor: true, consultation: true },
    });

    if (!appointment) throw new NotFoundException('Appointment not found');

    const isPatient = appointment.patientId === userId;
    const isDoctor = appointment.doctor.userId === userId;
    if (!isPatient && !isDoctor) {
      throw new ForbiddenException('Not authorized for this consultation session');
    }

    if (
      appointment.status !== 'CONFIRMED' &&
      appointment.status !== 'IN_PROGRESS'
    ) {
      throw new BadRequestException(
        `Cannot update consultation session for appointment in state ${appointment.status}`,
      );
    }

    if (!isDoctor && (newStatus === 'LIVE' || newStatus === 'ENDED')) {
      throw new ForbiddenException(
        `Only the doctor can transition consultation to ${newStatus}`,
      );
    }

    const slotTimeMs = appointment.slotTime.getTime();
    const nowMs = now.getTime();
    const windowStartMs = slotTimeMs - 10 * 60 * 1000;
    const startDeadlineMs = slotTimeMs + 30 * 60 * 1000;

    if (newStatus === 'LIVE' && (nowMs < windowStartMs || nowMs > startDeadlineMs)) {
      throw new BadRequestException(
        `Consultation can only go LIVE within [slotTime - 10min, slotTime + 30min] (${new Date(
          windowStartMs,
        ).toISOString()} to ${new Date(startDeadlineMs).toISOString()})`,
      );
    }

    if (newStatus === 'ENDED' && nowMs < windowStartMs) {
      throw new BadRequestException(
        `Consultation cannot be ended before its scheduled window opens (${new Date(
          windowStartMs,
        ).toISOString()})`,
      );
    }

    if (appointment.consultation) {
      assertSessionTransition(
        appointment.consultation.status as SessionStatus,
        newStatus,
      );
    } else if (newStatus === 'ENDED') {
      assertSessionTransition('SCHEDULED', 'ENDED');
    }

    return this.prisma.$transaction(async (tx) => {
      const roomName = `consult-${appointment.id}`;
      const session = await tx.consultationSession.upsert({
        where: { appointmentId },
        create: {
          appointmentId,
          roomName,
          status: newStatus,
          startedAt: newStatus === 'LIVE' ? now : undefined,
          endedAt: newStatus === 'ENDED' ? now : undefined,
          doctorJoinedAt: isDoctor && newStatus === 'LIVE' ? now : undefined,
          patientJoinedAt: isPatient && newStatus === 'WAITING' ? now : undefined,
        },
        update: {
          status: newStatus,
          startedAt:
            newStatus === 'LIVE'
              ? appointment.consultation?.startedAt || now
              : undefined,
          endedAt: newStatus === 'ENDED' ? now : undefined,
          ...(isDoctor && newStatus === 'LIVE' && !appointment.consultation?.doctorJoinedAt
            ? { doctorJoinedAt: now }
            : {}),
        },
      });

      if (newStatus === 'LIVE' && appointment.status === 'CONFIRMED') {
        assertAppointmentTransition('CONFIRMED', 'IN_PROGRESS');
        await tx.appointment.update({
          where: { id: appointment.id },
          data: { status: 'IN_PROGRESS' },
        });
        await tx.outboxEvent.create({
          data: {
            aggregateType: 'APPOINTMENT',
            aggregateId: appointment.id,
            eventType: 'APPOINTMENT_IN_PROGRESS',
            payload: {
              appointmentId: appointment.id,
              patientId: appointment.patientId,
              doctorId: appointment.doctorId,
              startedAt: new Date().toISOString(),
            },
          },
        });
      } else if (
        newStatus === 'ENDED' &&
        (appointment.status === 'IN_PROGRESS' || appointment.status === 'CONFIRMED')
      ) {
        assertAppointmentTransition(
          appointment.status as AppointmentStatus,
          'COMPLETED',
        );
        await tx.appointment.update({
          where: { id: appointment.id },
          data: { status: 'COMPLETED' },
        });
        await tx.outboxEvent.create({
          data: {
            aggregateType: 'APPOINTMENT',
            aggregateId: appointment.id,
            eventType: 'APPOINTMENT_COMPLETED',
            payload: {
              appointmentId: appointment.id,
              patientId: appointment.patientId,
              doctorId: appointment.doctorId,
              endedAt: new Date().toISOString(),
            },
          },
        });
      }

      this.realtime.emitToConsultationRoom(
        appointment.id,
        'session_status_changed',
        {
          appointmentId: appointment.id,
          sessionStatus: newStatus,
        },
      );
      this.realtime.emitToUser(appointment.patientId, 'booking_updated', {
        appointmentId: appointment.id,
        status:
          newStatus === 'LIVE'
            ? 'IN_PROGRESS'
            : newStatus === 'ENDED'
            ? 'COMPLETED'
            : appointment.status,
      });

      return session;
    });
  }
}
