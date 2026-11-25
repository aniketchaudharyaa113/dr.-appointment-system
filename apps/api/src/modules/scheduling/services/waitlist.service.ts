import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../platform/database/prisma.service';
import { RedisService } from '../../platform/redis/redis.service';
import { BookingService } from './booking.service';
import { getIstDateString } from '../../../common/utils/ist-time';

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
      throw new BadRequestException(
        'You are already on the waitlist for this doctor on this date',
      );
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
    const istDateStr = getIstDateString(new Date(slotTimeIso));
    const dateOnly = new Date(`${istDateStr}T00:00:00.000Z`);

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

    const claimExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
    const holdToken = randomBytes(24).toString('hex');

    await this.redis.acquireSlotHold(
      doctorId,
      slotTimeIso,
      nextInLine.patientId,
      holdToken,
      900,
    );

    const updated = await this.prisma.waitlist.update({
      where: { id: nextInLine.id },
      data: {
        status: 'OFFERED',
        offeredAt: new Date(),
        claimExpiresAt,
        holdToken,
        slotTime: slotTimeIso,
      },
    });

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
      throw new BadRequestException(
        `Offer is not active (current status: ${entry.status})`,
      );
    }

    if (entry.claimExpiresAt && new Date() > entry.claimExpiresAt) {
      await this.prisma.waitlist.update({
        where: { id: waitlistId },
        data: { status: 'EXPIRED' },
      });
      throw new BadRequestException(
        'Claim offer window (15 minutes) has expired',
      );
    }

    if (!entry.holdToken || !entry.slotTime) {
      throw new BadRequestException('Waitlist offer is missing slot or hold token');
    }

    const appointment = await this.bookingService.bookAppointment(
      entry.doctorId,
      entry.slotTime,
      patientId,
      entry.holdToken,
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
