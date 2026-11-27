import { buildNextSlotCacheKey } from './timezone';

/**
 * Releases unpaid PENDING_PAYMENT appointments older than expiryMinutes atomically,
 * failing open INITIATED/PENDING payments and emitting APPOINTMENT_EXPIRED + AppointmentSlotFreed.
 * Shared identically between API BookingService and WorkerEngine.
 */
export async function releaseExpiredPendingAppointmentsShared(
  prisma: any,
  redisClient: any,
  expiryMinutes = 15,
  now: Date = new Date(),
): Promise<Array<{ id: string; doctor_id: string; patient_id: string; slot_time: Date }>> {
  const cutoff = new Date(now.getTime() - expiryMinutes * 60 * 1000);

  const released = (await prisma.$transaction(async (tx: any) => {
    const candidates = (await tx.$queryRaw`
      SELECT a.id, a.doctor_id, a.patient_id, a.slot_time
      FROM appointments a
      LEFT JOIN payments p ON p.appointment_id = a.id
      WHERE a.status = 'PENDING_PAYMENT'
        AND a.created_at < ${cutoff}
        AND (p.id IS NULL OR p.status <> 'CAPTURED')
      FOR UPDATE OF a SKIP LOCKED
    `) as Array<{ id: string; doctor_id: string; patient_id: string; slot_time: Date }>;

    for (const appt of candidates) {
      await tx.appointment.update({
        where: { id: appt.id },
        data: {
          status: 'CANCELLED',
          cancellationReason: 'Payment window expired',
        },
      });

      await tx.payment.updateMany({
        where: {
          appointmentId: appt.id,
          status: { in: ['INITIATED', 'PENDING'] },
        },
        data: { status: 'FAILED' },
      });

      const slotIso = new Date(appt.slot_time).toISOString();
      await tx.outboxEvent.create({
        data: {
          aggregateType: 'APPOINTMENT',
          aggregateId: appt.id,
          eventType: 'APPOINTMENT_EXPIRED',
          payload: {
            appointmentId: appt.id,
            doctorId: appt.doctor_id,
            patientId: appt.patient_id,
            slotTime: slotIso,
          },
        },
      });

      await tx.outboxEvent.create({
        data: {
          aggregateType: 'APPOINTMENT',
          aggregateId: appt.id,
          eventType: 'AppointmentSlotFreed',
          payload: {
            appointmentId: appt.id,
            doctorId: appt.doctor_id,
            slotTime: slotIso,
          },
        },
      });
    }

    return candidates;
  })) as Array<{ id: string; doctor_id: string; patient_id: string; slot_time: Date }>;

  if (redisClient && released.length > 0) {
    for (const appt of released) {
      await redisClient.del(buildNextSlotCacheKey(appt.doctor_id));
    }
  }

  return released;
}
