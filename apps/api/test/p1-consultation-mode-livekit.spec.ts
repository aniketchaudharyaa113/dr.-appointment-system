import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  bootTestApp,
  resetDatabaseAndRedis,
  seedVerifiedDoctor,
  seedPatient,
  TestContext,
} from './helpers/test-app';
import { LiveKitService } from '../src/modules/consultation/services/livekit.service';
import { BadRequestException } from '@nestjs/common';

describe('P1-13: Consultation Mode Enforcement & Conditional LiveKit Minting', () => {
  let ctx: TestContext;
  let livekitService: LiveKitService;

  beforeAll(async () => {
    ctx = await bootTestApp();
    await resetDatabaseAndRedis(ctx.prisma, ctx.redisClient);
    livekitService = ctx.app.get(LiveKitService);
  });

  afterAll(async () => {
    if (ctx) await ctx.app.close();
  });

  it('mints LiveKit video token ONLY for VIDEO mode appointments and rejects IN_CLINIC / CHAT', async () => {
    const { doctor, user: docUser } = await seedVerifiedDoctor(ctx.prisma);
    const patient = await seedPatient(ctx.prisma);

    const now = new Date();
    const slot1 = new Date(now.getTime());
    const slot2 = new Date(now.getTime() + 15 * 60 * 1000);
    const slot3 = new Date(now.getTime() + 30 * 60 * 1000);

    // 1. Create VIDEO appointment
    const videoAppt = await ctx.prisma.appointment.create({
      data: {
        bookingRef: `MB-VID-${Math.random().toString(36).slice(2, 8)}`,
        doctorId: doctor.id,
        patientId: patient.id,
        slotTime: slot1,
        status: 'CONFIRMED',
        consultationMode: 'VIDEO',
      },
    });

    // Record consent
    await livekitService.recordConsent(videoAppt.id, patient.id);

    // Doctor can mint token for VIDEO
    const tokenResult = await livekitService.mintJoinToken(videoAppt.id, docUser.id, slot1);
    expect(tokenResult).toBeDefined();
    expect(tokenResult.token).toBeDefined();
    expect(tokenResult.roomName).toContain(videoAppt.id);

    // 2. Create IN_CLINIC appointment
    const inClinicAppt = await ctx.prisma.appointment.create({
      data: {
        bookingRef: `MB-CLI-${Math.random().toString(36).slice(2, 8)}`,
        doctorId: doctor.id,
        patientId: patient.id,
        slotTime: slot2,
        status: 'CONFIRMED',
        consultationMode: 'IN_CLINIC',
      },
    });

    await livekitService.recordConsent(inClinicAppt.id, patient.id);

    await expect(
      livekitService.mintJoinToken(inClinicAppt.id, docUser.id, slot2),
    ).rejects.toThrowError(BadRequestException);

    // 3. Create CHAT appointment
    const chatAppt = await ctx.prisma.appointment.create({
      data: {
        bookingRef: `MB-CHT-${Math.random().toString(36).slice(2, 8)}`,
        doctorId: doctor.id,
        patientId: patient.id,
        slotTime: slot3,
        status: 'CONFIRMED',
        consultationMode: 'CHAT',
      },
    });

    await livekitService.recordConsent(chatAppt.id, patient.id);

    await expect(
      livekitService.mintJoinToken(chatAppt.id, docUser.id, slot3),
    ).rejects.toThrowError(BadRequestException);
  });
});
