import { Injectable, BadRequestException, Inject } from '@nestjs/common';
import { PrismaService } from '../../platform/database/prisma.service';
import { RedisService } from '../../platform/redis/redis.service';

export interface GeneratedSlot {
  slotTime: string; // ISO string
  displayTime: string; // HH:mm
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
   * Using clinic timezone (Asia/Kolkata).
   */
  async getDoctorSlotsForDate(
    doctorId: string,
    dateStr: string, // YYYY-MM-DD
  ): Promise<GeneratedSlot[]> {
    // 1. Verify doctor availability for this day of week
    const targetDate = new Date(`${dateStr}T00:00:00.000Z`);
    if (isNaN(targetDate.getTime())) {
      throw new BadRequestException('Invalid date format. Expected YYYY-MM-DD');
    }

    // Day of week in Asia/Kolkata
    // (0 = Sunday, 1 = Monday, ..., 6 = Saturday)
    const dayOfWeek = targetDate.getUTCDay();

    const availabilityList = await this.prisma.availability.findMany({
      where: { doctorId, dayOfWeek },
    });

    if (availabilityList.length === 0) {
      return [];
    }

    // 2. Check doctor leaves on this date
    const onLeave = await this.prisma.doctorLeave.findFirst({
      where: {
        doctorId,
        startDate: { lte: targetDate },
        endDate: { gte: targetDate },
      },
    });

    // 3. Fetch existing active bookings on this date
    const startOfDay = new Date(`${dateStr}T00:00:00.000Z`);
    const endOfDay = new Date(`${dateStr}T23:59:59.999Z`);

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
        const slotTimeIso = `${dateStr}T${displayTime}:00.000Z`;

        const isBooked = bookedIsoSet.has(slotTimeIso);
        const heldBy = await this.redis.getSlotHold(doctorId, slotTimeIso);
        const isHeld = !!heldBy;
        const isOnLeave = !!onLeave;

        const isAvailable = !isBooked && !isHeld && !isOnLeave;

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

    return slots;
  }

  /**
   * Caches and returns next available slot for a doctor
   */
  async getNextAvailableSlot(doctorId: string): Promise<string | null> {
    const cacheKey = `cache:next_slot:${doctorId}`;
    const client = this.redis.getClient();

    if (client) {
      const cached = await client.get(cacheKey);
      if (cached) return cached;
    }

    // Look ahead 7 days
    const now = new Date();
    for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
      const d = new Date(now);
      d.setDate(d.getDate() + dayOffset);
      const dateStr = d.toISOString().split('T')[0];

      const slots = await this.getDoctorSlotsForDate(doctorId, dateStr);
      const available = slots.find((s) => s.isAvailable);

      if (available) {
        if (client) {
          await client.set(cacheKey, available.slotTime, 'EX', 60); // 60s cache
        }
        return available.slotTime;
      }
    }

    return null;
  }

  /**
   * Validates if a proposed slotTime aligns with doctor's working schedule
   */
  async validateSlotAlignment(
    doctorId: string,
    slotTime: Date,
  ): Promise<{ isValid: boolean; reason?: string }> {
    const dateStr = slotTime.toISOString().split('T')[0];
    const targetIso = slotTime.toISOString();

    const slots = await this.getDoctorSlotsForDate(doctorId, dateStr);
    const matchingSlot = slots.find(
      (s) => new Date(s.slotTime).getTime() === new Date(targetIso).getTime(),
    );

    if (!matchingSlot) {
      return {
        isValid: false,
        reason: 'Slot time is outside doctor working hours or misaligned to slot duration grid',
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
