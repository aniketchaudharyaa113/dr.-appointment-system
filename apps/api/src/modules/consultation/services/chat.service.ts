import {
  Injectable,
  Inject,
  ForbiddenException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../platform/database/prisma.service';

@Injectable()
export class ChatService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Sends a message inside consultation room `consult:<appointmentId>`.
   * Enforces:
   * 1. Authorization: sender must be patient or doctor of the appointment.
   * 2. Follow-up window: messages allowed up to 7 days after visit completion.
   */
  async sendMessage(params: {
    appointmentId: string;
    senderId: string;
    content: string;
    attachmentUrl?: string;
    attachmentType?: string;
    now?: Date;
  }) {
    const { appointmentId, senderId, content, attachmentUrl, attachmentType } = params;
    const now = params.now || new Date();

    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: { doctor: true },
    });

    if (!appointment) {
      throw new NotFoundException(`Appointment ${appointmentId} not found`);
    }

    const isPatient = appointment.patientId === senderId;
    const isDoctor = appointment.doctor.userId === senderId;

    if (!isPatient && !isDoctor) {
      throw new ForbiddenException(
        'Access denied: You are not a participant in this consultation room',
      );
    }

    // Follow-up chat window check: 7 days after appointment
    if (appointment.status === 'COMPLETED') {
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      const completedTime = appointment.updatedAt.getTime();
      if (now.getTime() - completedTime > sevenDaysMs) {
        throw new BadRequestException(
          'Follow-up chat window has closed (limited to 7 days post-consultation)',
        );
      }
    }

    const senderRole = isDoctor ? 'DOCTOR' : 'PATIENT';

    const message = await this.prisma.chatMessage.create({
      data: {
        appointmentId,
        senderId,
        senderRole,
        content,
        attachmentUrl,
        attachmentType,
        status: 'SENT',
      },
    });

    return message;
  }

  /**
   * Retrieves paginated messages for consultation room.
   */
  async getMessages(
    appointmentId: string,
    userId: string,
    limit = 50,
    before?: Date,
  ) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: { doctor: true },
    });

    if (!appointment) {
      throw new NotFoundException(`Appointment ${appointmentId} not found`);
    }

    const isPatient = appointment.patientId === userId;
    const isDoctor = appointment.doctor.userId === userId;

    if (!isPatient && !isDoctor) {
      throw new ForbiddenException(
        'Access denied: You are not a participant in this consultation',
      );
    }

    const messages = await this.prisma.chatMessage.findMany({
      where: {
        appointmentId,
        createdAt: before ? { lt: before } : undefined,
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 100),
    });

    return messages.reverse(); // Return in chronological order
  }

  /**
   * Marks unread messages as read.
   */
  async markRead(appointmentId: string, readerUserId: string) {
    await this.prisma.chatMessage.updateMany({
      where: {
        appointmentId,
        senderId: { not: readerUserId },
        status: { in: ['SENT', 'DELIVERED'] },
      },
      data: {
        status: 'READ',
        readAt: new Date(),
      },
    });

    return { success: true };
  }
}
