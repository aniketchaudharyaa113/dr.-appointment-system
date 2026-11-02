import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
import { PrismaService } from '../../platform/database/prisma.service';
import { RedisService } from '../../platform/redis/redis.service';
import { BookingService } from './booking.service';

@Injectable()
export class WaitlistService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(BookingService) private readonly bookingService: BookingService,
  ) {}

  async joinWaitlist(
    doctorId: string,
    patientId: string,
    slotDateStr: string,
    slotTime?: string,
  ) {
    const slotDate = new Date(`${slotDateStr}T00:00:00.000Z`);

    const existing = await this.prisma.waitlist.findFirst({
      where: {
        doctorId,
        patientId,
        slotDate,
        status: { in: ['WAITING', 'OFFERED'] },
      },
    });

    if (existing) {
      throw new BadRequestException('You are already on the waitlist for this doctor on this date');
    }

    return this.prisma.waitlist.create({
      data: {
        doctorId,
        patientId,
        slotDate,
        slotTime,
        status: 'WAITING',
      },
    });
  }

  /**
   * Cascading offer: When a slot is cancelled, offer it to the next patient in line
   */
  async offerCancelledSlotToNext(doctorId: string, slotTimeIso: string) {
    const dateOnly = new Date(`${slotTimeIso.split('T')[0]}T00:00:00.000Z`);

    const nextInLine = await this.prisma.waitlist.findFirst({
      where: {
        doctorId,
        slotDate: dateOnly,
        status: 'WAITING',
      },
      orderBy: { createdAt: 'asc' },
    });

    if (!nextInLine) {
      return null;
    }

    // 15-minute claim lease (900 seconds)
    const claimExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
    const holdToken = `waitlist:${nextInLine.id}:${slotTimeIso}`;

    await this.redis.acquireSlotHold(
      doctorId,
      slotTimeIso,
      nextInLine.patientId,
      900,
    );

    const updated = await this.prisma.waitlist.update({
      where: { id: nextInLine.id },
      data: {
        status: 'OFFERED',
        offeredAt: new Date(),
        claimExpiresAt,
        holdToken,
      },
    });

    // Outbox notification
    await this.prisma.outboxEvent.create({
      data: {
        aggregateType: 'WAITLIST',
        aggregateId: nextInLine.id,
        eventType: 'WaitlistSlotOffered',
        payload: {
          waitlistId: nextInLine.id,
          patientId: nextInLine.patientId,
          doctorId,
          slotTime: slotTimeIso,
          claimExpiresAt: claimExpiresAt.toISOString(),
        },
      },
    });

    return updated;
  }

  async claimWaitlistOffer(waitlistId: string, patientId: string) {
    const entry = await this.prisma.waitlist.findUnique({
      where: { id: waitlistId },
    });

    if (!entry) {
      throw new NotFoundException('Waitlist entry not found');
    }

    if (entry.patientId !== patientId) {
      throw new ForbiddenException('Not authorized to claim this waitlist offer');
    }

    if (entry.status !== 'OFFERED') {
      throw new BadRequestException(`Offer is not active (current status: ${entry.status})`);
    }

    if (entry.claimExpiresAt && new Date() > entry.claimExpiresAt) {
      await this.prisma.waitlist.update({
        where: { id: waitlistId },
        data: { status: 'EXPIRED' },
      });
      throw new BadRequestException('Claim offer window (15 minutes) has expired');
    }

    // Book the appointment
    const slotTimeIso = entry.holdToken?.split(':')[2] || entry.slotDate.toISOString();
    const appointment = await this.bookingService.bookAppointment(
      entry.doctorId,
      slotTimeIso,
      patientId,
      'VIDEO',
      'Booked via waitlist offer claim',
    );

    await this.prisma.waitlist.update({
      where: { id: waitlistId },
      data: { status: 'CLAIMED' },
    });

    return appointment;
  }
}
