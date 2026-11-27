import { DEFAULT_PLATFORM_COMMISSION_BPS } from '../constants';

export interface NoShowSweepResult {
  noShowCount: number;
  doctorNoShowCount: number;
  freedSlots: Array<{ doctorId: string; slotTime: string }>;
}

/**
 * Shared no-show sweep executed by both the API cron/service and the BullMQ worker.
 *
 * Rules:
 * - Evaluates CONFIRMED appointments past slotTime + 30 minutes whose consultation never went LIVE/ENDED.
 * - If the patient waited (consent granted, WAITING session, or patientJoinedAt) AND the doctor never joined
 *   (doctorJoinedAt is null), treats it as Doctor No-Show: cancels the appointment, frees the slot, and issues
 *   a 100% auto-refund with balanced double-entry ledger entries and outbox events.
 * - Otherwise marks the appointment NO_SHOW.
 */
export async function executeNoShowSweep(
  prisma: any,
  options?: { now?: Date; commissionBps?: number },
): Promise<NoShowSweepResult> {
  const now = options?.now ?? new Date();
  const commissionBps = options?.commissionBps ?? DEFAULT_PLATFORM_COMMISSION_BPS;
  const cutoff = new Date(now.getTime() - 30 * 60 * 1000);

  const candidateRows = (await prisma.appointment.findMany({
    where: {
      status: 'CONFIRMED',
      slotTime: { lt: cutoff },
      OR: [
        { consultation: null },
        { consultation: { status: { in: ['SCHEDULED', 'WAITING'] } } },
      ],
    },
    select: {
      id: true,
      bookingRef: true,
      patientId: true,
      doctorId: true,
      slotTime: true,
    },
  })) as Array<{
    id: string;
    bookingRef: string | null;
    patientId: string;
    doctorId: string;
    slotTime: Date;
  }>;

  let noShowCount = 0;
  let doctorNoShowCount = 0;
  const freedSlots: Array<{ doctorId: string; slotTime: string }> = [];

  for (const appt of candidateRows) {
    await prisma.$transaction(async (tx: any) => {
      // Lock order: appointments -> payments -> refunds
      const lockedRows = (await tx.$queryRaw`
        SELECT id, status::text AS status
        FROM appointments
        WHERE id = ${appt.id}::uuid
        FOR UPDATE
      `) as Array<{ id: string; status: string }>;

      if (!lockedRows[0] || lockedRows[0].status !== 'CONFIRMED') return;

      const session = await tx.consultationSession.findUnique({
        where: { appointmentId: appt.id },
        select: {
          id: true,
          status: true,
          patientConsentGiven: true,
          patientJoinedAt: true,
          doctorJoinedAt: true,
        },
      });

      if (session && (session.status === 'LIVE' || session.status === 'ENDED')) {
        return;
      }

      const doctorJoined = Boolean(session?.doctorJoinedAt);
      const patientPresent = Boolean(
        session?.patientJoinedAt ||
          session?.patientConsentGiven ||
          session?.status === 'WAITING',
      );

      if (!doctorJoined && patientPresent) {
        const reason = 'Doctor did not join consultation within 30 minutes';
        const paymentRows = (await tx.$queryRaw`
          SELECT id, status::text AS status, amount_paise, provider_payment_id
          FROM payments
          WHERE appointment_id = ${appt.id}::uuid
          FOR UPDATE
        `) as Array<{
          id: string;
          status: string;
          amount_paise: number;
          provider_payment_id: string | null;
        }>;

        await tx.appointment.update({
          where: { id: appt.id },
          data: {
            status: 'CANCELLED',
            cancellationReason: reason,
          },
        });

        if (session) {
          await tx.consultationSession.update({
            where: { id: session.id },
            data: { status: 'ENDED', endedAt: now },
          });
        }

        const payment = paymentRows[0];
        if (payment && payment.status === 'CAPTURED') {
          const refundAmountPaise = Number(payment.amount_paise);
          const refund = await tx.refund.create({
            data: {
              paymentId: payment.id,
              amountPaise: refundAmountPaise,
              reason: 'Doctor no-show auto-refund (100%)',
              status: 'PENDING',
            },
          });

          await tx.payment.update({
            where: { id: payment.id },
            data: { status: 'REFUNDED' },
          });

          const platformFeeReversal = Math.round(
            (refundAmountPaise * commissionBps) / 10000,
          );
          const doctorShareReversal = refundAmountPaise - platformFeeReversal;

          await tx.ledgerEntry.createMany({
            data: [
              {
                transactionId: payment.id,
                accountType: 'DOCTOR_PAYABLE',
                entryType: 'DEBIT',
                amountPaise: doctorShareReversal,
                description: 'Reversal of doctor payout obligation due to doctor no-show refund',
              },
              {
                transactionId: payment.id,
                accountType: 'PLATFORM_REVENUE',
                entryType: 'DEBIT',
                amountPaise: platformFeeReversal,
                description: 'Reversal of platform commission due to doctor no-show refund',
              },
              {
                transactionId: payment.id,
                accountType: 'ESCROW',
                entryType: 'CREDIT',
                amountPaise: refundAmountPaise,
                description: 'Refund cash outflow from escrow to patient (doctor no-show)',
              },
            ],
          });

          await tx.outboxEvent.create({
            data: {
              aggregateType: 'PAYMENT',
              aggregateId: payment.id,
              eventType: 'PAYMENT_REFUND_REQUESTED',
              payload: {
                refundId: refund.id,
                paymentId: payment.id,
                providerPaymentId: payment.provider_payment_id ?? null,
                amountPaise: refundAmountPaise,
                reason: 'Doctor no-show auto-refund (100%)',
              },
            },
          });
        }

        const slotIso = appt.slotTime.toISOString();
        await tx.outboxEvent.create({
          data: {
            aggregateType: 'APPOINTMENT',
            aggregateId: appt.id,
            eventType: 'APPOINTMENT_CANCELLED',
            payload: {
              appointmentId: appt.id,
              bookingRef: appt.bookingRef,
              patientId: appt.patientId,
              doctorId: appt.doctorId,
              slotTime: slotIso,
              reason,
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
              doctorId: appt.doctorId,
              slotTime: slotIso,
            },
          },
        });

        freedSlots.push({ doctorId: appt.doctorId, slotTime: slotIso });
        doctorNoShowCount++;
        return;
      }

      await tx.appointment.update({
        where: { id: appt.id },
        data: { status: 'NO_SHOW' },
      });

      await tx.outboxEvent.create({
        data: {
          aggregateType: 'APPOINTMENT',
          aggregateId: appt.id,
          eventType: 'APPOINTMENT_NO_SHOW',
          payload: {
            appointmentId: appt.id,
            patientId: appt.patientId,
            doctorId: appt.doctorId,
            slotTime: appt.slotTime.toISOString(),
          },
        },
      });
      noShowCount++;
    });
  }

  return { noShowCount, doctorNoShowCount, freedSlots };
}
