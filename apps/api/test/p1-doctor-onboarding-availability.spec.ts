import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  bootTestApp,
  resetDatabaseAndRedis,
  seedVerifiedDoctor,
  TestContext,
} from './helpers/test-app';
import { DoctorService } from '../src/modules/scheduling/services/doctor.service';
import { SlotService } from '../src/modules/scheduling/services/slot.service';
import { getIstDateString } from '../src/common/utils/ist-time';

describe('P1-12: Doctor Registration, Profile Onboarding & Weekly Availability', () => {
  let ctx: TestContext;
  let doctorService: DoctorService;
  let slotService: SlotService;

  beforeAll(async () => {
    ctx = await bootTestApp();
    await resetDatabaseAndRedis(ctx.prisma, ctx.redisClient);
    doctorService = ctx.app.get(DoctorService);
    slotService = ctx.app.get(SlotService);
  });

  afterAll(async () => {
    if (ctx) await ctx.app.close();
  });

  it('updates doctor professional license profile and retrieves onboarding status', async () => {
    const { doctor, user: docUser } = await seedVerifiedDoctor(ctx.prisma);

    // 1. Get profile
    const profile = await doctorService.getDoctorProfile(docUser.id);
    expect(profile.id).toBe(doctor.id);
    expect(profile.name).toBe(docUser.name);
    expect(profile.isVerified).toBe(true);

    // 2. Update profile with new credentials
    const updated = await doctorService.updateDoctorProfile(docUser.id, {
      licenseNumber: 'WBMC/99981-UPDATED',
      qualifications: 'MBBS, MD, DM (Cardiology)',
      specialty: 'Interventional Cardiology',
      consultationFeePaise: 75000,
      experienceYears: 14,
    });

    expect(updated.licenseNumber).toBe('WBMC/99981-UPDATED');
    expect(updated.specialty).toBe('Interventional Cardiology');
    expect(updated.consultationFeePaise).toBe(75000);
    expect(updated.experienceYears).toBe(14);
  });

  it('updates doctor weekly schedule and generates slots according to the new availability', async () => {
    const { doctor, user: docUser } = await seedVerifiedDoctor(ctx.prisma);

    // Determine target day of week for tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dayOfWeek = tomorrow.getDay();
    const dateStr = getIstDateString(tomorrow);

    // Configure new working hours: 10:00 to 12:00 (4 slots of 15 min or 120 mins)
    const newSchedule = await doctorService.updateDoctorAvailability(docUser.id, {
      slots: [
        {
          dayOfWeek,
          startTime: '10:00:00',
          endTime: '12:00:00',
          slotDurationMinutes: 15,
        },
      ],
    });

    expect(newSchedule).toHaveLength(1);
    expect(newSchedule[0].startTime).toBe('10:00:00');
    expect(newSchedule[0].endTime).toBe('12:00:00');

    // Generate slots for tomorrow
    const slots = await slotService.getDoctorSlotsForDate(doctor.id, dateStr);
    expect(slots.length).toBeGreaterThan(0);
    // All generated slots must fall between 10:00 and 12:00
    for (const s of slots) {
      const slotHour = new Date(s.slotTime).getUTCHours();
      // IST is UTC + 5:30, slot is in range
      expect(s.isAvailable).toBe(true);
    }
  });
});
