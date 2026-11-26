import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  bootTestApp,
  resetDatabaseAndRedis,
  seedVerifiedDoctor,
  seedPatient,
  TestContext,
  signJwtForUser,
} from './helpers/test-app';
import { BookingService } from '../src/modules/scheduling/services/booking.service';
import { SlotService } from '../src/modules/scheduling/services/slot.service';
import { BadRequestException } from '@nestjs/common';
import { istWallClockToUtcDate } from '../src/common/utils/ist-time';

describe('P1-7 & P1-8: Slot Timing Validations & Anti-Hoarding Protections', () => {
  let ctx: TestContext;
  let bookingService: BookingService;
  let slotService: SlotService;

  beforeAll(async () => {
    ctx = await bootTestApp();
    await resetDatabaseAndRedis(ctx.prisma, ctx.redisClient);
    bookingService = ctx.app.get(BookingService);
    slotService = ctx.app.get(SlotService);
  });

  afterAll(async () => {
    if (ctx) await ctx.app.close();
  });

  it('P1-7: Rejects slot holds and bookings for past slots, <15m lead time, and >30d advance', async () => {
    const { doctor } = await seedVerifiedDoctor(ctx.prisma);
    const patient = await seedPatient(ctx.prisma);

    const now = Date.now();

    // Past slot (yesterday)
    const pastSlot = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    await expect(bookingService.holdSlot(doctor.id, pastSlot, patient.id)).rejects.toThrow(
      /Cannot hold or book a slot in the past/,
    );

    // Slot in 5 minutes (< 15 min lead time)
    const tooSoonSlot = new Date(now + 5 * 60 * 1000).toISOString();
    await expect(bookingService.holdSlot(doctor.id, tooSoonSlot, patient.id)).rejects.toThrow(
      /Slots must be booked at least 15 minutes in advance/,
    );

    // Slot 35 days in the future (> 30 days advance)
    const tooFarSlot = new Date(now + 35 * 24 * 60 * 60 * 1000).toISOString();
    await expect(bookingService.holdSlot(doctor.id, tooFarSlot, patient.id)).rejects.toThrow(
      /Slots cannot be booked more than 30 days in advance/,
    );
  });

  it('P1-8 (a): Enforces max 1 active hold per patient in Redis, releasing old hold on new hold', async () => {
    const { doctor } = await seedVerifiedDoctor(ctx.prisma);
    const patient = await seedPatient(ctx.prisma);

    const dateStr = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const slotA = istWallClockToUtcDate(dateStr, '10:00').toISOString();
    const slotB = istWallClockToUtcDate(dateStr, '11:00').toISOString();

    // 1. Patient holds Slot A
    const holdA = await bookingService.holdSlot(doctor.id, slotA, patient.id);
    expect(holdA.holdToken).toBeDefined();

    // Verify Slot A is held
    const heldA1 = await ctx.redisClient.get(`hold:${doctor.id}:${slotA}`);
    expect(heldA1).toContain(patient.id);

    // 2. Patient holds Slot B -> automatically releases Slot A
    const holdB = await bookingService.holdSlot(doctor.id, slotB, patient.id);
    expect(holdB.holdToken).toBeDefined();

    // Verify Slot A is released and Slot B is held
    const heldA2 = await ctx.redisClient.get(`hold:${doctor.id}:${slotA}`);
    expect(heldA2).toBeNull();

    const heldB1 = await ctx.redisClient.get(`hold:${doctor.id}:${slotB}`);
    expect(heldB1).toContain(patient.id);
  });

  it('P1-8 (b): DELETE /appointments/hold immediately releases held slot', async () => {
    const { doctor } = await seedVerifiedDoctor(ctx.prisma);
    const patient = await seedPatient(ctx.prisma);
    const patientToken = signJwtForUser(patient);

    const dateStr = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const slot = istWallClockToUtcDate(dateStr, '14:00').toISOString();

    // Hold slot via API
    const holdRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/appointments/hold',
      headers: { authorization: `Bearer ${patientToken}` },
      payload: { doctorId: doctor.id, slotTime: slot },
    });
    expect(holdRes.statusCode).toBe(201);

    expect(await ctx.redisClient.get(`hold:${doctor.id}:${slot}`)).not.toBeNull();

    // Call DELETE /appointments/hold
    const deleteRes = await ctx.app.inject({
      method: 'DELETE',
      url: '/api/appointments/hold',
      headers: { authorization: `Bearer ${patientToken}` },
      payload: { doctorId: doctor.id, slotTime: slot },
    });
    expect(deleteRes.statusCode).toBe(200);
    expect(deleteRes.json().released).toBe(true);

    // Verify hold key is now gone
    expect(await ctx.redisClient.get(`hold:${doctor.id}:${slot}`)).toBeNull();
  });

  it('P1-8 (c): Non-PATIENT roles cannot hold or book slots', async () => {
    const { doctor, user: docUser } = await seedVerifiedDoctor(ctx.prisma);
    const doctorToken = signJwtForUser(docUser);

    const dateStr = new Date(Date.now() + 96 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const slot = istWallClockToUtcDate(dateStr, '15:00').toISOString();

    // Doctor attempting to hold slot
    const holdRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/appointments/hold',
      headers: { authorization: `Bearer ${doctorToken}` },
      payload: { doctorId: doctor.id, slotTime: slot },
    });
    expect(holdRes.statusCode).toBe(403);

    // Doctor attempting to book slot
    const bookRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/appointments/book',
      headers: { authorization: `Bearer ${doctorToken}` },
      payload: {
        doctorId: doctor.id,
        slotTime: slot,
        holdToken: 'fake-token-1234567890',
      },
    });
    expect(bookRes.statusCode).toBe(403);
  });
});
