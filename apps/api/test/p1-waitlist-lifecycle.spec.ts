import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  bootTestApp,
  resetDatabaseAndRedis,
  seedVerifiedDoctor,
  seedPatient,
  TestContext,
} from './helpers/test-app';
import { BookingService } from '../src/modules/scheduling/services/booking.service';
import { WaitlistService } from '../src/modules/scheduling/services/waitlist.service';
import { istWallClockToUtcDate, getIstDateString } from '../src/common/utils/ist-time';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('P1-4: Waitlist Lifecycle, Atomic Claim & Cascading Offers', () => {
  let ctx: TestContext;
  let bookingService: BookingService;
  let waitlistService: WaitlistService;

  beforeAll(async () => {
    ctx = await bootTestApp();
    await resetDatabaseAndRedis(ctx.prisma, ctx.redisClient);
    bookingService = ctx.app.get(BookingService);
    waitlistService = ctx.app.get(WaitlistService);
  });

  afterAll(async () => {
    if (ctx) await ctx.app.close();
  });

  it('validates doctor existence, past dates, and slot unavailability on joinWaitlist', async () => {
    const { doctor } = await seedVerifiedDoctor(ctx.prisma);
    const patient = await seedPatient(ctx.prisma);

    const futureDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const futureDateStr = getIstDateString(futureDate);
    const futureSlotIso = istWallClockToUtcDate(futureDateStr, '14:00').toISOString();

    // 1. Rejects non-existent doctor
    await expect(
      waitlistService.joinWaitlist(
        '00000000-0000-0000-0000-000000000000',
        patient.id,
        futureDateStr,
      ),
    ).rejects.toThrow(NotFoundException);

    // 2. Rejects past dates
    await expect(
      waitlistService.joinWaitlist(doctor.id, patient.id, '2020-01-01'),
    ).rejects.toThrow(BadRequestException);

    // 3. Rejects free slot (waitlist is only for unavailable slots)
    await expect(
      waitlistService.joinWaitlist(doctor.id, patient.id, futureDateStr, futureSlotIso),
    ).rejects.toThrow(BadRequestException);

    // 4. Book slot first, then joinWaitlist succeeds
    const hold = await bookingService.holdSlot(doctor.id, futureSlotIso, patient.id);
    await bookingService.bookAppointment(doctor.id, futureSlotIso, patient.id, hold.holdToken);

    const otherPatient = await seedPatient(ctx.prisma);
    const waitEntry = await waitlistService.joinWaitlist(
      doctor.id,
      otherPatient.id,
      futureDateStr,
      futureSlotIso,
    );
    expect(waitEntry.status).toBe('WAITING');
  });

  it('handles atomic claim, custom consultation mode, and duplicate-claim prevention', async () => {
    const { doctor } = await seedVerifiedDoctor(ctx.prisma);
    const patientA = await seedPatient(ctx.prisma);
    const patientB = await seedPatient(ctx.prisma);

    const futureDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const futureDateStr = getIstDateString(futureDate);
    const futureSlotIso = istWallClockToUtcDate(futureDateStr, '15:00').toISOString();

    // Patient A books slot
    const holdA = await bookingService.holdSlot(doctor.id, futureSlotIso, patientA.id);
    const apptA = await bookingService.bookAppointment(doctor.id, futureSlotIso, patientA.id, holdA.holdToken);

    // Patient B joins waitlist
    const waitB = await waitlistService.joinWaitlist(doctor.id, patientB.id, futureDateStr, futureSlotIso);

    // Patient A cancels appointment -> triggers AppointmentSlotFreed outbox event
    await bookingService.cancelAppointment(apptA.id, patientA.id, 'Conflict');

    const slotFreedEvent = await ctx.prisma.outboxEvent.findFirst({
      where: {
        aggregateId: apptA.id,
        eventType: 'AppointmentSlotFreed',
      },
    });
    expect(slotFreedEvent).toBeDefined();

    // Cascading offer triggered
    const offer = await waitlistService.offerCancelledSlotToNext(doctor.id, futureSlotIso);
    expect(offer?.status).toBe('OFFERED');
    expect(offer?.patientId).toBe(patientB.id);

    // Atomic claim with IN_CLINIC mode
    const claimedAppt = await waitlistService.claimWaitlistOffer(
      waitB.id,
      patientB.id,
      'IN_CLINIC',
    );
    expect(claimedAppt.status).toBe('PENDING_PAYMENT');
    expect(claimedAppt.consultationMode).toBe('IN_CLINIC');

    // Duplicate concurrent claim throws BadRequestException
    await expect(
      waitlistService.claimWaitlistOffer(waitB.id, patientB.id),
    ).rejects.toThrow(BadRequestException);
  });

  it('leaveWaitlist releases hold and cascades offer to next patient in line', async () => {
    const { doctor } = await seedVerifiedDoctor(ctx.prisma);
    const patientA = await seedPatient(ctx.prisma);
    const patientB = await seedPatient(ctx.prisma);
    const patientC = await seedPatient(ctx.prisma);

    const futureDate = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000);
    const futureDateStr = getIstDateString(futureDate);
    const futureSlotIso = istWallClockToUtcDate(futureDateStr, '16:00').toISOString();

    // Patient A books slot
    const holdA = await bookingService.holdSlot(doctor.id, futureSlotIso, patientA.id);
    const apptA = await bookingService.bookAppointment(doctor.id, futureSlotIso, patientA.id, holdA.holdToken);

    // Patients B and C join waitlist in order
    const waitB = await waitlistService.joinWaitlist(doctor.id, patientB.id, futureDateStr, futureSlotIso);
    const waitC = await waitlistService.joinWaitlist(doctor.id, patientC.id, futureDateStr, futureSlotIso);

    // Patient A cancels
    await bookingService.cancelAppointment(apptA.id, patientA.id, 'Change of plans');

    // Slot is offered to Patient B
    const offerB = await waitlistService.offerCancelledSlotToNext(doctor.id, futureSlotIso);
    expect(offerB?.id).toBe(waitB.id);
    expect(offerB?.status).toBe('OFFERED');

    // Patient B leaves waitlist (rejects offer)
    const leaveRes = await waitlistService.leaveWaitlist(waitB.id, patientB.id);
    expect(leaveRes.status).toBe('CANCELLED');

    // Offer automatically cascaded to Patient C!
    const refreshedWaitC = await ctx.prisma.waitlist.findUnique({
      where: { id: waitC.id },
    });
    expect(refreshedWaitC?.status).toBe('OFFERED');
    expect(refreshedWaitC?.holdToken).toBeDefined();
  });
});
