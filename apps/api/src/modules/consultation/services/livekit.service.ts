import {
  Injectable,
  Inject,
  ForbiddenException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { AccessToken } from 'livekit-server-sdk';
import { PrismaService } from '../../platform/database/prisma.service';

export interface VideoTokenResult {
  token: string;
  roomName: string;
  status: string;
  windowStart: string;
  windowEnd: string;
}

@Injectable()
export class LiveKitService {
  private readonly apiKey: string;
  private readonly apiSecret: string;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {
    this.apiKey = process.env.LIVEKIT_API_KEY || 'devkey';
    this.apiSecret = process.env.LIVEKIT_API_SECRET || 'secret_placeholder_for_local_testing_123';
  }

  /**
   * Mints short-lived LiveKit join token.
   * Enforces:
   * 1. Only verified appointment participants (patient or doctor) can join.
   * 2. Join window: [slotTime - 10min, slotTime + 30min]. Outside this window, returns HTTP 400.
   * 3. Telemedicine consent must be granted.
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

    // 1. Authorization check
    const isPatient = appointment.patientId === userId;
    const isDoctor = appointment.doctor.userId === userId;

    if (!isPatient && !isDoctor) {
      throw new ForbiddenException(
        'Access denied: You are not an authorized participant in this consultation',
      );
    }

    // 2. Join window check [slotTime - 10m, slotTime + 30m]
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

    // 3. Ensure consultation session exists
    let session = appointment.consultation;
    const roomName = `room_${appointment.id.replace(/-/g, '').slice(0, 16)}`;

    if (!session) {
      session = await this.prisma.consultationSession.create({
        data: {
          appointmentId: appointment.id,
          roomName,
          status: 'SCHEDULED',
        },
      });
    }

    // 4. Patient telemedicine consent check
    if (isPatient && !session.patientConsentGiven) {
      throw new BadRequestException(
        'Patient must accept telemedicine consent before joining consultation',
      );
    }

    // 5. Mint LiveKit JWT access token
    const participantName = isDoctor ? `Dr. Consultation` : `Patient`;
    const at = new AccessToken(this.apiKey, this.apiSecret, {
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
      roomName: session.roomName,
      status: session.status,
      windowStart: new Date(windowStartMs).toISOString(),
      windowEnd: new Date(windowEndMs).toISOString(),
    };
  }

  /**
   * Records patient telemedicine consent with timestamp.
   */
  async recordConsent(appointmentId: string, userId: string): Promise<boolean> {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: { consultation: true },
    });

    if (!appointment || appointment.patientId !== userId) {
      throw new ForbiddenException('Only the appointed patient can grant telemedicine consent');
    }

    const roomName = `room_${appointment.id.replace(/-/g, '').slice(0, 16)}`;
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

  /**
   * Update session status (WAITING -> LIVE -> ENDED)
   */
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

    const isDoctor = appointment.doctor.userId === userId;
    if (!isDoctor && newStatus === 'LIVE') {
      throw new ForbiddenException('Only the doctor can transition consultation to LIVE');
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
