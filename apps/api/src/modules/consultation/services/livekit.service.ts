import {
  Injectable,
  Inject,
  ForbiddenException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { AccessToken } from 'livekit-server-sdk';
import { PrismaService } from '../../platform/database/prisma.service';
import { env } from '../../../common/config/env.schema';

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
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

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

    if (!isDoctor && newStatus === 'LIVE') {
      throw new ForbiddenException(
        'Only the doctor can transition consultation to LIVE',
      );
    }

    return this.prisma.consultationSession.update({
      where: { appointmentId },
      data: {
        status: newStatus,
        startedAt: newStatus === 'LIVE' ? new Date() : undefined,
        endedAt: newStatus === 'ENDED' ? new Date() : undefined,
      },
    });
  }
}
