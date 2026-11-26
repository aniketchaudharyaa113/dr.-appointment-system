import { Injectable, BadRequestException, Inject } from '@nestjs/common';
import { PrismaService } from '../../platform/database/prisma.service';
import { RedisService } from '../../platform/redis/redis.service';
import {
  getIstDateString,
  getIstDayBoundsUtc,
  getIstDayOfWeek,
  istWallClockToUtcDate,
} from '../../../common/utils/ist-time';

export interface GeneratedSlot {
  slotTime: string; // ISO string (UTC instant corresponding to IST wall clock)
  displayTime: string; // HH:mm in Asia/Kolkata
  isAvailable: boolean;
  isHeld: boolean;
  isBooked: boolean;
  isOnLeave: boolean;
}

@Injectable()
export class SlotService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  /**
   * Generates discrete slot times aligned to doctor's duration grid for a given date
   * using clinic timezone (Asia/Kolkata).
   */
  async getDoctorSlotsForDate(
    doctorId: string,
    dateStr: string, // YYYY-MM-DD in Asia/Kolkata
  ): Promise<GeneratedSlot[]> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      throw new BadRequestException('Invalid date format. Expected YYYY-MM-DD');
    }

    const dayOfWeek = getIstDayOfWeek(dateStr);

    const availabilityList = await this.prisma.availability.findMany({
      where: { doctorId, dayOfWeek },
    });

    if (availabilityList.length === 0) {
      return [];
    }

    const targetDateOnly = new Date(`${dateStr}T00:00:00.000Z`);
    const onLeave = await this.prisma.doctorLeave.findFirst({
      where: {
        doctorId,
        startDate: { lte: targetDateOnly },
        endDate: { gte: targetDateOnly },
      },
    });

    const { start: startOfDay, end: endOfDay } = getIstDayBoundsUtc(dateStr);

    const existingAppointments = await this.prisma.appointment.findMany({
      where: {
        doctorId,
        slotTime: { gte: startOfDay, lte: endOfDay },
        status: { in: ['PENDING_PAYMENT', 'CONFIRMED'] },
      },
      select: { slotTime: true },
    });

    const bookedIsoSet = new Set(
      existingAppointments.map((a) => a.slotTime.toISOString()),
    );

    const nowMs = Date.now();
    const minLeadTimeMs = 15 * 60 * 1000; // 15 minutes minimum lead time
    const maxAdvanceMs = 30 * 24 * 60 * 60 * 1000; // 30 days max advance

    const slots: GeneratedSlot[] = [];

    for (const avail of availabilityList) {
      const [startHour, startMin] = avail.startTime.split(':').map(Number);
      const [endHour, endMin] = avail.endTime.split(':').map(Number);
      const slotDuration = avail.slotDurationMinutes;

      let currentMinutes = startHour * 60 + startMin;
      const endMinutes = endHour * 60 + endMin;

      while (currentMinutes + slotDuration <= endMinutes) {
        const hour = Math.floor(currentMinutes / 60);
        const min = currentMinutes % 60;
        const displayTime = `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
        const slotDateUtc = istWallClockToUtcDate(dateStr, displayTime);
        const slotTimeIso = slotDateUtc.toISOString();
        const slotMs = slotDateUtc.getTime();

        const isPastOrTooSoon = slotMs < nowMs + minLeadTimeMs;
        const isBeyondMaxAdvance = slotMs > nowMs + maxAdvanceMs;

        const isBooked = bookedIsoSet.has(slotTimeIso);
        const held = await this.redis.getSlotHold(doctorId, slotTimeIso);
        const isHeld = !!held;
        const isOnLeave = !!onLeave;

        const isAvailable =
          !isBooked && !isHeld && !isOnLeave && !isPastOrTooSoon && !isBeyondMaxAdvance;

        slots.push({
          slotTime: slotTimeIso,
          displayTime,
          isAvailable,
          isHeld,
          isBooked,
          isOnLeave,
        });

        currentMinutes += slotDuration;
      }
    }

    const seenSlots = new Set<string>();
    const uniqueSlots: GeneratedSlot[] = [];
    for (const slot of slots) {
      if (!seenSlots.has(slot.slotTime)) {
        seenSlots.add(slot.slotTime);
        uniqueSlots.push(slot);
      }
    }

    uniqueSlots.sort((a, b) => a.slotTime.localeCompare(b.slotTime));
    return uniqueSlots;
  }

  /**
   * Caches and returns next available slot for a doctor in Asia/Kolkata
   */
  async getNextAvailableSlot(doctorId: string): Promise<string | null> {
    const cacheKey = `cache:next_slot:${doctorId}`;
    const client = this.redis.getClient();

    if (client) {
      try {
        const cached = await client.get(cacheKey);
        if (cached) return cached;
      } catch {
        // Ignore Redis cache miss errors
      }
    }

    const nowMs = Date.now();
    const todayIst = getIstDateString(new Date(nowMs));
    const baseUtcNoon = new Date(`${todayIst}T12:00:00.000+05:30`);

    for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
      const d = new Date(baseUtcNoon.getTime() + dayOffset * 24 * 60 * 60 * 1000);
      const dateStr = getIstDateString(d);

      const slots = await this.getDoctorSlotsForDate(doctorId, dateStr);
      const available = slots.find(
        (s) => s.isAvailable && new Date(s.slotTime).getTime() > nowMs,
      );

      if (available) {
        if (client) {
          try {
            await client.set(cacheKey, available.slotTime, 'EX', 60);
          } catch {
            // Ignore Redis cache write errors
          }
        }
        return available.slotTime;
      }
    }

    return null;
  }

  /**
   * Validates if a proposed slotTime aligns with doctor's working schedule in Asia/Kolkata
   */
  async validateSlotAlignment(
    doctorId: string,
    slotTime: Date,
  ): Promise<{ isValid: boolean; reason?: string }> {
    const nowMs = Date.now();
    const slotMs = slotTime.getTime();
    const minLeadTimeMs = 15 * 60 * 1000; // 15 minutes minimum lead time
    const maxAdvanceMs = 30 * 24 * 60 * 60 * 1000; // 30 days maximum advance

    if (slotMs <= nowMs) {
      return { isValid: false, reason: 'Cannot hold or book a slot in the past' };
    }
    if (slotMs < nowMs + minLeadTimeMs) {
      return { isValid: false, reason: 'Slots must be booked at least 15 minutes in advance' };
    }
    if (slotMs > nowMs + maxAdvanceMs) {
      return { isValid: false, reason: 'Slots cannot be booked more than 30 days in advance' };
    }

    const dateStr = getIstDateString(slotTime);
    const targetMs = slotTime.getTime();

    const slots = await this.getDoctorSlotsForDate(doctorId, dateStr);
    const matchingSlot = slots.find(
      (s) => new Date(s.slotTime).getTime() === targetMs,
    );

    if (!matchingSlot) {
      return {
        isValid: false,
        reason:
          'Slot time is outside doctor working hours or misaligned to slot duration grid',
      };
    }

    if (matchingSlot.isOnLeave) {
      return { isValid: false, reason: 'Doctor is on leave on this date' };
    }

    if (matchingSlot.isBooked) {
      return { isValid: false, reason: 'Slot is already booked' };
    }

    return { isValid: true };
  }
}
