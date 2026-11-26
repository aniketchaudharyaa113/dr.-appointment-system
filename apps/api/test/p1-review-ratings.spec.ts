import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  bootTestApp,
  resetDatabaseAndRedis,
  seedVerifiedDoctor,
  seedPatient,
  TestContext,
} from './helpers/test-app';
import { BookingService } from '../src/modules/scheduling/services/booking.service';
import { DoctorService } from '../src/modules/scheduling/services/doctor.service';
import { BadRequestException, ForbiddenException, ConflictException } from '@nestjs/common';

describe('P1-5: Appointment Review System & Accurate Doctor Rating Aggregates', () => {
  let ctx: TestContext;
  let bookingService: BookingService;
  let doctorService: DoctorService;

  beforeAll(async () => {
    ctx = await bootTestApp();
    await resetDatabaseAndRedis(ctx.prisma, ctx.redisClient);
    bookingService = ctx.app.get(BookingService);
    doctorService = ctx.app.get(DoctorService);
  });

  afterAll(async () => {
    if (ctx) await ctx.app.close();
  });

  it('allows patients to review COMPLETED appointments once and updates Doctor ratingAvg/ratingCount', async () => {
    const { doctor } = await seedVerifiedDoctor(ctx.prisma);
    const patientA = await seedPatient(ctx.prisma);
    const patientB = await seedPatient(ctx.prisma);

    // Create 2 completed appointments for this doctor
    const appt1 = await ctx.prisma.appointment.create({
      data: {
        bookingRef: `MB-REV1-${Math.random().toString(36).slice(2, 8)}`,
        doctorId: doctor.id,
        patientId: patientA.id,
        slotTime: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        status: 'COMPLETED',
        consultationMode: 'VIDEO',
      },
    });

    const appt2 = await ctx.prisma.appointment.create({
      data: {
        bookingRef: `MB-REV2-${Math.random().toString(36).slice(2, 8)}`,
        doctorId: doctor.id,
        patientId: patientB.id,
        slotTime: new Date(Date.now() - 24 * 60 * 60 * 1000),
        status: 'COMPLETED',
        consultationMode: 'VIDEO',
      },
    });

    // 1. Patient A submits review (rating: 5)
    const rev1 = await bookingService.reviewAppointment(
      appt1.id,
      patientA.id,
      5,
      'Excellent consultation! Very attentive and knowledgeable.',
    );
    expect(rev1.id).toBeDefined();
    expect(rev1.rating).toBe(5);

    // Verify denormalized columns on Doctor
    let updatedDoctor = await ctx.prisma.doctor.findUnique({
      where: { id: doctor.id },
    });
    expect(updatedDoctor?.ratingCount).toBe(1);
    expect(updatedDoctor?.ratingAvg).toBe(5);

    // 2. Patient A cannot review the same appointment again (ConflictException)
    await expect(
      bookingService.reviewAppointment(appt1.id, patientA.id, 4, 'Trying again'),
    ).rejects.toThrow(ConflictException);

    // 3. Patient B submits review (rating: 4)
    await bookingService.reviewAppointment(
      appt2.id,
      patientB.id,
      4,
      'Good advice, helped clarify my symptoms.',
    );

    updatedDoctor = await ctx.prisma.doctor.findUnique({
      where: { id: doctor.id },
    });
    expect(updatedDoctor?.ratingCount).toBe(2);
    // (5 + 4) / 2 = 4.5
    expect(updatedDoctor?.ratingAvg).toBe(4.5);

    // 4. getDoctorById reflects accurate ratings and reviews list
    const doctorProfile = await doctorService.getDoctorById(doctor.id);
    expect(doctorProfile.reviewCount).toBe(2);
    expect(doctorProfile.averageRating).toBe(4.5);
    expect(doctorProfile.reviews.length).toBe(2);
    expect(doctorProfile.reviews[0].patientName).toBeDefined();
  });

  it('rejects reviews on non-completed appointments or from unauthorized users', async () => {
    const { doctor } = await seedVerifiedDoctor(ctx.prisma);
    const patientA = await seedPatient(ctx.prisma);
    const stranger = await seedPatient(ctx.prisma);

    const confirmedAppt = await ctx.prisma.appointment.create({
      data: {
        bookingRef: `MB-REV3-${Math.random().toString(36).slice(2, 8)}`,
        doctorId: doctor.id,
        patientId: patientA.id,
        slotTime: new Date(),
        status: 'CONFIRMED',
        consultationMode: 'VIDEO',
      },
    });

    // 1. Rejects review on CONFIRMED appointment
    await expect(
      bookingService.reviewAppointment(confirmedAppt.id, patientA.id, 5, 'Early review'),
    ).rejects.toThrow(BadRequestException);

    // 2. Stranger cannot review appointment
    await expect(
      bookingService.reviewAppointment(confirmedAppt.id, stranger.id, 5, 'Fake review'),
    ).rejects.toThrow(ForbiddenException);
  });
});
