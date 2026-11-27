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
import { getIstDateString } from '../../../common/utils/ist-time';
import {
  ConsultationMode,
  offerCancelledSlotToNextShared,
} from '@medibook/shared';

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
    // 1. Verify doctor exists, is verified, and account is active
    const doctor = await this.prisma.doctor.findUnique({
      where: { id: doctorId },
      include: { user: { select: { isActive: true } } },
    });
    if (!doctor || !doctor.isVerified || !doctor.user?.isActive) {
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
    return offerCancelledSlotToNextShared(
      this.prisma,
      this.redis.getClient(),
      doctorId,
      slotTimeIso,
    );
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
      // Only revert to OFFERED if the Redis hold AND claim window are genuinely still valid;
      // otherwise mark EXPIRED so dead holds are never re-exposed.
      const held = await this.redis.getSlotHold(entry.doctorId, entry.slotTime);
      const stillHeldByPatient = Boolean(
        held &&
          held.token === entry.holdToken &&
          held.patientId === patientId &&
          entry.claimExpiresAt &&
          entry.claimExpiresAt > new Date(),
      );

      await this.prisma.waitlist.updateMany({
        where: { id: waitlistId, status: 'CLAIMED' },
        data: { status: stillHeldByPatient ? 'OFFERED' : 'EXPIRED' },
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

    // Atomic conditional update prevents overwriting a concurrent CLAIMED transition
    const updateRes = await this.prisma.waitlist.updateMany({
      where: {
        id: waitlistId,
        patientId,
        status: { in: ['WAITING', 'OFFERED'] },
      },
      data: { status: 'CANCELLED' },
    });

    if (updateRes.count === 0) {
      const current = await this.prisma.waitlist.findUnique({
        where: { id: waitlistId },
        select: { status: true },
      });
      throw new BadRequestException(
        `Cannot leave waitlist entry with status ${current?.status ?? entry.status}`,
      );
    }

    const updated = await this.prisma.waitlist.findUniqueOrThrow({
      where: { id: waitlistId },
    });

    if (entry.status === 'OFFERED' && entry.holdToken && entry.slotTime) {
      await this.redis.releaseSlotHold(
        entry.doctorId,
        entry.slotTime,
        entry.holdToken,
        entry.patientId,
      );
      await this.offerCancelledSlotToNext(entry.doctorId, entry.slotTime);
    }

    return updated;
  }
}
