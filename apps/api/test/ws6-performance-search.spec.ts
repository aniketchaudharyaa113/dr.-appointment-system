import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import {
  bootTestApp,
  resetDatabaseAndRedis,
  seedVerifiedDoctor,
  TestContext,
} from './helpers/test-app';
import { SlotService } from '../src/modules/scheduling/services/slot.service';
import { DoctorService } from '../src/modules/scheduling/services/doctor.service';
import { getIstDateString } from '@medibook/shared';

describe('WS6: Scheduling Performance, Negative Cache & LIKE Wildcard Escaping (B26)', () => {
  let ctx: TestContext;
  let slotService: SlotService;
  let doctorService: DoctorService;

  beforeAll(async () => {
    ctx = await bootTestApp();
    slotService = ctx.app.get(SlotService);
    doctorService = ctx.app.get(DoctorService);
  });

  afterAll(async () => {
    if (ctx) await ctx.app.close();
  });

  beforeEach(async () => {
    await resetDatabaseAndRedis(ctx.prisma, ctx.redisClient);
    vi.restoreAllMocks();
  });

  it('B26.1: getDoctorSlotsForDate batches slot hold lookups with a single Redis MGET instead of N GETs', async () => {
    const { doctor } = await seedVerifiedDoctor(ctx.prisma);
    const tomorrowDateStr = getIstDateString(new Date(Date.now() + 24 * 60 * 60 * 1000));

    // Seed one held slot first (09:00 IST = 03:30 UTC)
    const heldIso = new Date(`${tomorrowDateStr}T09:00:00.000+05:30`).toISOString();
    await ctx.redis.acquireSlotHold(doctor.id, heldIso, 'patient-test', 'tok-123', 600);

    const getSpy = vi.spyOn(ctx.redisClient, 'get');
    const mgetSpy = vi.spyOn(ctx.redisClient, 'mget');

    const slots = await slotService.getDoctorSlotsForDate(doctor.id, tomorrowDateStr);
    expect(slots.length).toBe(44);

    const heldSlot = slots.find((s) => s.slotTime === heldIso);
    expect(heldSlot?.isHeld).toBe(true);
    expect(heldSlot?.isAvailable).toBe(false);

    // Must not issue 44 sequential GET calls
    expect(getSpy).not.toHaveBeenCalled();
    expect(mgetSpy).toHaveBeenCalledTimes(1);
  });

  it('B26.2: getNextAvailableSlot caches negative result sentinel and clears it when updateDoctorAvailability runs', async () => {
    const { user, doctor } = await seedVerifiedDoctor(ctx.prisma);

    // Remove all availability so no slots exist in the next 7 days
    await ctx.prisma.availability.deleteMany({ where: { doctorId: doctor.id } });

    const first = await slotService.getNextAvailableSlot(doctor.id);
    expect(first).toBeNull();

    // Negative cache sentinel must be persisted in Redis
    const cachedVal = await ctx.redisClient.get(`cache:next_slot:${doctor.id}`);
    expect(cachedVal).toBeTruthy();

    // Second searchDoctors or getNextAvailableSlot must hit negative cache without rescanning 7 days
    const scanSpy = vi.spyOn(slotService, 'getDoctorSlotsForDate');
    const searchRes = await doctorService.searchDoctors({ page: 1, limit: 10 });
    const docCard = searchRes.data.find((d) => d.id === doctor.id);
    expect(docCard?.nextAvailableSlot).toBeNull();
    expect(scanSpy).not.toHaveBeenCalled();

    // Updating availability must invalidate cache:next_slot:{doctorId}
    await doctorService.updateDoctorAvailability(user.id, {
      slots: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
        dayOfWeek,
        startTime: '10:00',
        endTime: '12:00',
        slotDurationMinutes: 30,
      })),
    });

    const refreshed = await slotService.getNextAvailableSlot(doctor.id);
    expect(refreshed).not.toBeNull();
  });

  it('B26.3: searchDoctors escapes %, _, and ! LIKE wildcards in ILIKE search queries', async () => {
    const { doctor: alice } = await seedVerifiedDoctor(ctx.prisma, {
      name: 'Dr. Alice Normal',
      specialty: 'Cardiology',
    });
    await ctx.prisma.doctor.update({
      where: { id: alice.id },
      data: { clinicName: 'Heart Clinic' },
    });

    const { doctor: bob } = await seedVerifiedDoctor(ctx.prisma, {
      name: 'Dr. Bob Literal',
      specialty: 'Cardiology',
    });
    await ctx.prisma.doctor.update({
      where: { id: bob.id },
      data: { clinicName: '100% Care Center' },
    });

    const { doctor: charlie } = await seedVerifiedDoctor(ctx.prisma, {
      name: 'Dr. Charlie Underscore',
      specialty: 'Neurology',
    });
    await ctx.prisma.doctor.update({
      where: { id: charlie.id },
      data: { clinicName: 'neuro_lab' },
    });

    const percentRes = await doctorService.searchDoctors({ symptomQuery: '%', page: 1, limit: 10 });
    expect(percentRes.data.map((d) => d.id)).toEqual([bob.id]);

    const underscoreRes = await doctorService.searchDoctors({ symptomQuery: '_', page: 1, limit: 10 });
    expect(underscoreRes.data.map((d) => d.id)).toEqual([charlie.id]);
  });
});
