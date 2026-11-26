import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Inject,
  Logger,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../platform/database/prisma.service';
import { RedisService } from '../../platform/redis/redis.service';
import { BookingService } from './booking.service';
import { getIstDateString } from '../../../common/utils/ist-time';
import { ConsultationMode } from '@medibook/shared';

@Injectable()
export class WaitlistService {
  private readonly logger = new Logger(WaitlistService.name);

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
    // 1. Verify doctor exists
    const doctor = await this.prisma.doctor.findUnique({
      where: { id: doctorId },
    });
    if (!doctor) {
      throw new NotFoundException(`Doctor ${doctorId} not found`);
    }

    // 2. Verify date and time are in the future
    const nowIstDate = getIstDateString(new Date());
    if (slotDateStr < nowIstDate) {
      throw new BadRequestException('Cannot join waitlist for past dates');
    }
    if (slotTime && new Date(slotTime) <= new Date()) {
      throw new BadRequestException('Cannot join waitlist for past slot time');
    }

    // 3. If a specific slotTime is given, ensure it is actually booked/unavailable
    if (slotTime) {
      const activeAppt = await this.prisma.appointment.findFirst({
        where: {
          doctorId,
          slotTime: new Date(slotTime),
          status: { in: ['CONFIRMED', 'PENDING_PAYMENT', 'HELD'] },
        },
      });
      const hold = await this.redis.getSlotHold(doctorId, slotTime);
      if (!activeAppt && !hold) {
        throw new BadRequestException(
          'Slot is currently available for direct booking; waitlist is only for unavailable slots',
        );
      }
    }

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
   * Cascading offer: When a slot is cancelled or freed, offer it to the next patient in line.
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

    const holdAcquired = await this.redis.acquireSlotHold(
      doctorId,
      slotTimeIso,
      nextInLine.patientId,
      holdToken,
      900,
    );

    if (!holdAcquired) {
      this.logger.warn(
        `Failed to acquire slot hold for waitlist offer: doctor=${doctorId}, slotTime=${slotTimeIso}`,
      );
      return null;
    }

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

  /**
   * Claims an active waitlist offer atomically, preventing double-claim races.
   */
  async claimWaitlistOffer(
    waitlistId: string,
    patientId: string,
    consultationMode: ConsultationMode = 'VIDEO',
  ) {
    const entry = await this.prisma.waitlist.findUnique({
      where: { id: waitlistId },
    });

    if (!entry) {
      throw new NotFoundException('Waitlist entry not found');
    }

    if (entry.patientId !== patientId) {
      throw new ForbiddenException('Not authorized to claim this waitlist offer');
    }

    if (!entry.holdToken || !entry.slotTime) {
      throw new BadRequestException('Waitlist offer is missing slot or hold token');
    }

    // Atomic updateMany: guarantees only one concurrent caller succeeds in claiming
    const updateResult = await this.prisma.waitlist.updateMany({
      where: {
        id: waitlistId,
        patientId,
        status: 'OFFERED',
        claimExpiresAt: { gt: new Date() },
      },
      data: { status: 'CLAIMED' },
    });

    if (updateResult.count === 0) {
      if (entry.claimExpiresAt && new Date() > entry.claimExpiresAt) {
        await this.prisma.waitlist.update({
          where: { id: waitlistId },
          data: { status: 'EXPIRED' },
        });
      }
      throw new BadRequestException(
        'Waitlist offer is no longer available or has expired',
      );
    }

    try {
      const appointment = await this.bookingService.bookAppointment(
        entry.doctorId,
        entry.slotTime,
        patientId,
        entry.holdToken,
        consultationMode,
        'Booked via waitlist offer claim',
      );
      return appointment;
    } catch (err) {
      // Revert status if booking throws
      await this.prisma.waitlist.update({
        where: { id: waitlistId },
        data: { status: 'OFFERED' },
      });
      throw err;
    }
  }

  /**
   * Patient cancels their waitlist entry or rejects an active offer.
   * If an active offer is cancelled, the slot is immediately offered to the next patient in line.
   */
  async leaveWaitlist(waitlistId: string, patientId: string) {
    const entry = await this.prisma.waitlist.findUnique({
      where: { id: waitlistId },
    });

    if (!entry) {
      throw new NotFoundException('Waitlist entry not found');
    }

    if (entry.patientId !== patientId) {
      throw new ForbiddenException('Not authorized to leave this waitlist entry');
    }

    if (entry.status !== 'WAITING' && entry.status !== 'OFFERED') {
      throw new BadRequestException(
        `Cannot leave waitlist entry with status ${entry.status}`,
      );
    }

    const wasOffered = entry.status === 'OFFERED';
    const updated = await this.prisma.waitlist.update({
      where: { id: waitlistId },
      data: { status: 'CANCELLED' },
    });

    if (wasOffered && entry.holdToken && entry.slotTime) {
      await this.redis.releaseSlotHold(
        entry.doctorId,
        entry.slotTime,
        entry.holdToken,
        entry.patientId,
      );
      // Immediately cascade offer to next in line
      await this.offerCancelledSlotToNext(entry.doctorId, entry.slotTime);
    }

    return updated;
  }
}
