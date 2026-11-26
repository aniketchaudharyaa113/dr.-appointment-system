import {
  Injectable,
  Inject,
  ForbiddenException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
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
  ): Promise<VideoTokenResult> {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        doctor: true,
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

    if (
      appointment.status === 'CANCELLED' ||
      appointment.status === 'REFUNDED' ||
      appointment.status === 'PENDING_PAYMENT'
    ) {
      throw new BadRequestException(
        `Cannot join video consultation while appointment status is ${appointment.status}`,
      );
    }

    const slotTimeMs = appointment.slotTime.getTime();
    const windowStartMs = slotTimeMs - 10 * 60 * 1000;
    const windowEndMs = slotTimeMs + 30 * 60 * 1000;
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
        },
      });
    }

    if (isPatient && !session.patientConsentGiven) {
      throw new BadRequestException(
        'Patient must accept telemedicine consent before joining consultation',
      );
    }

    const participantName = isDoctor ? 'Attending Doctor' : 'Patient';
    const at = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
      identity: userId,
      name: participantName,
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

    if (!appointment || appointment.patientId !== userId) {
      throw new ForbiddenException(
        'Only the appointed patient can grant telemedicine consent',
      );
    }

    const roomName = `consult-${appointment.id}`;
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
        consentTimestamp: new Date(),
      },
    });

    return true;
  }

  async updateSessionStatus(
    appointmentId: string,
    userId: string,
    newStatus: 'WAITING' | 'LIVE' | 'ENDED',
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

    if (appointment.consultation) {
      assertSessionTransition(
        appointment.consultation.status as SessionStatus,
        newStatus,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const roomName = `consult-${appointment.id}`;
      const session = await tx.consultationSession.upsert({
        where: { appointmentId },
        create: {
          appointmentId,
          roomName,
          status: newStatus,
          startedAt: newStatus === 'LIVE' ? new Date() : undefined,
          endedAt: newStatus === 'ENDED' ? new Date() : undefined,
        },
        update: {
          status: newStatus,
          startedAt:
            newStatus === 'LIVE'
              ? appointment.consultation?.startedAt || new Date()
              : undefined,
          endedAt: newStatus === 'ENDED' ? new Date() : undefined,
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
