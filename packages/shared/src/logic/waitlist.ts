import {
  buildSlotHoldKey,
  getClinicTimezone,
  getIstDateString,
} from './timezone';

function randomHex24(): string {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Shared waitlist offer algorithm used by both API and WorkerEngine.
 *
 * Guarantees:
 * - Resolves clinic calendar date in configured CLINIC_TIMEZONE (not UTC slice).
 * - Verifies doctor is verified & active and not on leave for that date.
 * - Verifies the slot has no active HELD/PENDING_PAYMENT/CONFIRMED/IN_PROGRESS booking in DB.
 * - Uses FOR UPDATE SKIP LOCKED matching (slot_time = slotTimeIso OR slot_time IS NULL).
 * - Acquires standard Redis hold:{doctorId}:{slotTimeIso} lease BEFORE marking OFFERED.
 */
export async function offerCancelledSlotToNextShared(
  prisma: any,
  redisClient: any,
  doctorId: string,
  slotTimeIso: string,
  options?: { now?: Date; timeZone?: string; holdTtlSeconds?: number },
): Promise<any | null> {
  const now = options?.now ?? new Date();
  const timeZone = options?.timeZone ?? getClinicTimezone();
  const holdTtlSeconds = options?.holdTtlSeconds ?? 900;

  const slotDateObj = new Date(slotTimeIso);
  if (Number.isNaN(slotDateObj.getTime())) {
    return null;
  }
  const normalizedSlotIso = slotDateObj.toISOString();
  const istDateStr = getIstDateString(slotDateObj, timeZone);
  const dateOnly = new Date(`${istDateStr}T00:00:00.000Z`);

  if (!redisClient) {
    return null;
  }

  const holdKey = buildSlotHoldKey(doctorId, normalizedSlotIso);
  const claimExpiresAt = new Date(now.getTime() + holdTtlSeconds * 1000);
  const holdToken = randomHex24();

  return prisma.$transaction(async (tx: any) => {
    const doctor = await tx.doctor.findUnique({
      where: { id: doctorId },
      include: { user: { select: { isActive: true } } },
    });
    if (!doctor || !doctor.isVerified || !doctor.user?.isActive) {
      return null;
    }

    const onLeave = await tx.doctorLeave.findFirst({
      where: {
        doctorId,
        startDate: { lte: dateOnly },
        endDate: { gte: dateOnly },
      },
    });
    if (onLeave) {
      return null;
    }

    // Re-check DB to ensure slot wasn't already rebooked
    const activeAppt = await tx.appointment.findFirst({
      where: {
        doctorId,
        slotTime: slotDateObj,
        status: { in: ['HELD', 'PENDING_PAYMENT', 'CONFIRMED', 'IN_PROGRESS'] },
      },
      select: { id: true },
    });
    if (activeAppt) {
      return null;
    }

    // Atomically lock next eligible WAITING entry, respecting requested slotTime if specified
    const lockedRows = (await tx.$queryRaw`
      SELECT id, patient_id
      FROM waitlists
      WHERE doctor_id = ${doctorId}::uuid
        AND slot_date = ${dateOnly}::date
        AND status = 'WAITING'
        AND (slot_time = ${normalizedSlotIso} OR slot_time = ${slotTimeIso} OR slot_time IS NULL)
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `) as Array<{ id: string; patient_id: string }>;

    const nextInLine = lockedRows[0];
    if (!nextInLine) {
      return null;
    }

    const holdValue = `${holdToken}:${nextInLine.patient_id}`;
    const holdRes = await redisClient.set(holdKey, holdValue, 'EX', holdTtlSeconds, 'NX');
    if (holdRes !== 'OK') {
      return null;
    }

    const updated = await tx.waitlist.update({
      where: { id: nextInLine.id },
      data: {
        status: 'OFFERED',
        offeredAt: now,
        claimExpiresAt,
        holdToken,
        slotTime: normalizedSlotIso,
      },
    });

    await tx.outboxEvent.create({
      data: {
        aggregateType: 'WAITLIST',
        aggregateId: nextInLine.id,
        eventType: 'WaitlistSlotOffered',
        payload: {
          waitlistId: nextInLine.id,
          patientId: nextInLine.patient_id,
          doctorId,
          slotTime: normalizedSlotIso,
          claimExpiresAt: claimExpiresAt.toISOString(),
        },
      },
    });

    return updated;
  });
}

/**
 * Expires overdue OFFERED waitlist rows atomically, safely releases matching Redis holds,
 * and cascades offers to the next eligible patient on the waitlist.
 */
export async function expireWaitlistOffersShared(
  prisma: any,
  redisClient: any,
  options?: { now?: Date; timeZone?: string },
): Promise<number> {
  const now = options?.now ?? new Date();

  const expiredOffers = (await prisma.$queryRaw`
    UPDATE waitlists
    SET status = 'EXPIRED'
    WHERE status = 'OFFERED'
      AND claim_expires_at < ${now}
    RETURNING id, doctor_id, patient_id, slot_time, hold_token
  `) as Array<{
    id: string;
    doctor_id: string;
    patient_id: string;
    slot_time: string | null;
    hold_token: string | null;
  }>;

  for (const offer of expiredOffers) {
    if (offer.hold_token && offer.slot_time && redisClient) {
      const holdKey = buildSlotHoldKey(offer.doctor_id, offer.slot_time);
      const expected = `${offer.hold_token}:${offer.patient_id}`;
      const releaseScript = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;
      await redisClient.eval(releaseScript, 1, holdKey, expected);
      await offerCancelledSlotToNextShared(
        prisma,
        redisClient,
        offer.doctor_id,
        offer.slot_time,
        options,
      );
    }
  }

  return expiredOffers.length;
}
