import { Injectable, BadRequestException, Inject } from '@nestjs/common';
import { LedgerService } from './ledger.service';

export type RefundInitiator = 'PATIENT' | 'DOCTOR' | 'ADMIN' | 'LEAVE';

@Injectable()
export class RefundPolicyService {
  constructor(
    @Inject(LedgerService) private readonly ledgerService: LedgerService,
  ) {}

  /**
   * Computes refund amount in paise according to MediBook policy:
   * - DOCTOR / ADMIN / LEAVE: 100%
   * - PATIENT >= 24h before slotTime: 100%
   * - PATIENT < 24h before slotTime: 50%
   */
  calculateRefundAmountPaise(params: {
    amountPaise: number;
    slotTime: Date;
    initiatedBy: RefundInitiator;
    now?: Date;
  }): { refundAmountPaise: number; refundPercent: number } {
    if (
      params.initiatedBy === 'DOCTOR' ||
      params.initiatedBy === 'ADMIN' ||
      params.initiatedBy === 'LEAVE'
    ) {
      return { refundAmountPaise: params.amountPaise, refundPercent: 100 };
    }

    const nowMs = (params.now ?? new Date()).getTime();
    const hoursUntilSlot = (params.slotTime.getTime() - nowMs) / (1000 * 60 * 60);
    if (hoursUntilSlot >= 24) {
      return { refundAmountPaise: params.amountPaise, refundPercent: 100 };
    }

    return {
      refundAmountPaise: Math.round(params.amountPaise * 0.5),
      refundPercent: 50,
    };
  }

  /**
   * Validates that an appointment is eligible for refund (blocks COMPLETED, IN_PROGRESS, NO_SHOW,
   * and past slots unless initiated by ADMIN).
   */
  assertRefundableAppointment(params: {
    status: string;
    slotTime: Date;
    actorRole: string;
    now?: Date;
  }) {
    if (['COMPLETED', 'IN_PROGRESS', 'NO_SHOW'].includes(params.status)) {
      throw new BadRequestException(
        `Cannot refund an appointment in status ${params.status}`,
      );
    }

    const now = params.now ?? new Date();
    if (params.actorRole !== 'ADMIN' && params.slotTime.getTime() <= now.getTime()) {
      throw new BadRequestException(
        'Cannot refund an appointment whose scheduled slot has already passed',
      );
    }
  }

  /**
   * Atomically creates a Refund row, marks Payment as REFUNDED, reverses the double-entry ledger,
   * and enqueues PAYMENT_REFUND_REQUESTED in the outbox inside an existing DB transaction.
   */
  async recordRefundInTx(
    tx: any,
    params: {
      paymentId: string;
      appointmentId: string;
      providerPaymentId?: string | null;
      refundAmountPaise: number;
      reason: string;
    },
  ) {
    const refund = await tx.refund.create({
      data: {
        paymentId: params.paymentId,
        amountPaise: params.refundAmountPaise,
        reason: params.reason,
        status: 'PENDING',
      },
    });

    await tx.payment.update({
      where: { id: params.paymentId },
      data: { status: 'REFUNDED' },
    });

    await this.ledgerService.recordRefund(
      params.paymentId,
      params.refundAmountPaise,
      1000,
      tx,
    );

    await tx.outboxEvent.create({
      data: {
        aggregateType: 'PAYMENT',
        aggregateId: params.paymentId,
        eventType: 'PAYMENT_REFUND_REQUESTED',
        payload: {
          refundId: refund.id,
          paymentId: params.paymentId,
          providerPaymentId: params.providerPaymentId ?? null,
          amountPaise: params.refundAmountPaise,
          reason: params.reason,
        },
      },
    });

    return refund;
  }
}
