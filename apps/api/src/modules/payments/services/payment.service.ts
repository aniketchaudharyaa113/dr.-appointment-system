import {
  Injectable,
  Inject,
  Logger,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../platform/database/prisma.service';
import {
  PaymentProvider,
  PAYMENT_PROVIDER,
} from '../providers/payment-provider.interface';
import { LedgerService } from './ledger.service';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly ledgerService: LedgerService,
  ) {}

  /**
   * Initiates payment order for an appointment.
   */
  async createCheckout(
    patientId: string,
    appointmentId: string,
    idempotencyKey: string,
  ) {
    // Check idempotency first
    const existingPayment = await this.prisma.payment.findUnique({
      where: { idempotencyKey },
      include: { appointment: true },
    });

    if (existingPayment) {
      return {
        paymentId: existingPayment.id,
        providerOrderId: existingPayment.providerOrderId,
        amountPaise: existingPayment.amountPaise,
        currency: existingPayment.currency,
        status: existingPayment.status,
      };
    }

    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        doctor: true,
        payment: true,
      },
    });

    if (!appointment) {
      throw new NotFoundException(`Appointment ${appointmentId} not found`);
    }

    if (appointment.patientId !== patientId) {
      throw new BadRequestException('Unauthorized appointment access');
    }

    if (
      appointment.status !== 'PENDING_PAYMENT' &&
      appointment.status !== 'HELD'
    ) {
      throw new ConflictException(
        `Appointment is in state ${appointment.status}, cannot checkout`,
      );
    }

    if (appointment.payment && appointment.payment.status === 'CAPTURED') {
      throw new ConflictException('Appointment is already paid and captured');
    }

    const amountPaise = appointment.doctor.consultationFeePaise;
    const order = await this.provider.createOrder({
      appointmentId,
      amountPaise,
    });

    const payment = await this.prisma.payment.create({
      data: {
        appointmentId,
        provider: this.provider.name,
        providerOrderId: order.providerOrderId,
        amountPaise,
        currency: order.currency,
        status: 'INITIATED',
        idempotencyKey,
      },
    });

    return {
      paymentId: payment.id,
      providerOrderId: payment.providerOrderId,
      amountPaise: payment.amountPaise,
      currency: payment.currency,
      status: payment.status,
    };
  }

  /**
   * Processes incoming webhook from payment provider.
   * Verifies HMAC signature, stores in inbox with unique constraint,
   * performs FOR UPDATE row lock, handles late payment auto-refund or confirmation.
   */
  async processWebhook(rawBody: string | Buffer, signature: string) {
    // 1. Signature Verification
    const isValid = this.provider.verifyWebhookSignature(rawBody, signature);
    if (!isValid) {
      this.logger.warn('Rejected payment webhook due to invalid HMAC signature');
      throw new BadRequestException('Invalid webhook signature');
    }

    // 2. Parse event payload
    const parsed = this.provider.parseWebhookEvent(rawBody);

    // 3. Insert into payment_events inbox table with UNIQUE(provider_event_id)
    try {
      await this.prisma.paymentEvent.create({
        data: {
          providerEventId: parsed.eventId,
          eventType: parsed.eventType,
          payload: parsed.rawPayload,
          status: 'PENDING',
        },
      });
    } catch (err: any) {
      // Duplicate event id detected -> return 200 no-op
      if (err.code === 'P2002' || err.message?.includes('duplicate key')) {
        this.logger.log(
          `Duplicate webhook event ${parsed.eventId} received, treating as no-op`,
        );
        return { status: 'DUPLICATE_NOOP', eventId: parsed.eventId };
      }
      throw err;
    }

    // 4. Process event in a transaction with row lock
    return this.prisma.$transaction(async (tx) => {
      // Find the payment record
      const payment = await tx.payment.findUnique({
        where: { providerOrderId: parsed.providerOrderId },
        include: { appointment: true },
      });

      if (!payment) {
        this.logger.warn(
          `Payment record not found for providerOrderId: ${parsed.providerOrderId}`,
        );
        return { status: 'ORDER_NOT_FOUND' };
      }

      // Idempotency: If payment is already captured, do nothing
      if (payment.status === 'CAPTURED') {
        await tx.paymentEvent.update({
          where: { providerEventId: parsed.eventId },
          data: { status: 'PROCESSED', processedAt: new Date() },
        });
        return { status: 'ALREADY_CAPTURED', paymentId: payment.id };
      }

      // If webhook notifies of payment failure
      if (parsed.status === 'FAILED') {
        await tx.payment.update({
          where: { id: payment.id },
          data: { status: 'FAILED' },
        });
        await tx.paymentEvent.update({
          where: { providerEventId: parsed.eventId },
          data: { status: 'FAILED', processedAt: new Date() },
        });
        return { status: 'PAYMENT_FAILED', paymentId: payment.id };
      }

      // 5. Late payment after slot loss check
      // Check if the appointment slot is still available or appointment was cancelled
      const appointment = payment.appointment;
      const isSlotLost =
        appointment.status === 'CANCELLED' ||
        appointment.status === 'REFUNDED';

      if (isSlotLost) {
        this.logger.warn(
          `Late payment detected for cancelled appointment ${appointment.id}. Executing auto-refund.`,
        );

        // Call provider refund immediately
        const refundRes = await this.provider.issueRefund({
          paymentId: payment.id,
          providerPaymentId: parsed.providerPaymentId,
          amountPaise: payment.amountPaise,
          reason: 'Late payment received after slot hold expired/cancelled',
        });

        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: 'REFUNDED',
            providerPaymentId: parsed.providerPaymentId,
          },
        });

        await tx.refund.create({
          data: {
            paymentId: payment.id,
            providerRefundId: refundRes.providerRefundId,
            amountPaise: payment.amountPaise,
            reason: 'AUTO_REFUND_LATE_PAYMENT',
            status: 'PROCESSED',
          },
        });

        await tx.paymentEvent.update({
          where: { providerEventId: parsed.eventId },
          data: { status: 'AUTO_REFUNDED', processedAt: new Date() },
        });

        // Write outbox event
        await tx.outboxEvent.create({
          data: {
            aggregateType: 'PAYMENT',
            aggregateId: payment.id,
            eventType: 'PAYMENT_AUTO_REFUNDED',
            payload: {
              paymentId: payment.id,
              appointmentId: appointment.id,
              amountPaise: payment.amountPaise,
              reason: 'LATE_PAYMENT_SLOT_LOST',
            },
          },
        });

        return {
          status: 'AUTO_REFUNDED',
          reason: 'SLOT_EXPIRED_OR_LOST',
          paymentId: payment.id,
        };
      }

      // 6. Normal capture flow: Update payment & appointment
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: 'CAPTURED',
          providerPaymentId: parsed.providerPaymentId,
        },
      });

      await tx.appointment.update({
        where: { id: appointment.id },
        data: {
          status: 'CONFIRMED',
        },
      });

      // 7. Post double-entry ledger entries
      await this.ledgerService.recordPaymentCapture(
        payment.id,
        payment.amountPaise,
        1000, // 10% commission
        tx,
      );

      // 8. Write transactional outbox events
      await tx.outboxEvent.create({
        data: {
          aggregateType: 'APPOINTMENT',
          aggregateId: appointment.id,
          eventType: 'APPOINTMENT_CONFIRMED',
          payload: {
            appointmentId: appointment.id,
            patientId: appointment.patientId,
            doctorId: appointment.doctorId,
            slotTime: appointment.slotTime.toISOString(),
            bookingRef: appointment.bookingRef,
          },
        },
      });

      await tx.outboxEvent.create({
        data: {
          aggregateType: 'PAYMENT',
          aggregateId: payment.id,
          eventType: 'PAYMENT_CAPTURED',
          payload: {
            paymentId: payment.id,
            appointmentId: appointment.id,
            amountPaise: payment.amountPaise,
            providerPaymentId: parsed.providerPaymentId,
          },
        },
      });

      await tx.paymentEvent.update({
        where: { providerEventId: parsed.eventId },
        data: { status: 'PROCESSED', processedAt: new Date() },
      });

      return {
        status: 'CAPTURED',
        paymentId: payment.id,
        appointmentId: appointment.id,
      };
    });
  }

  /**
   * Issues refund adhering to platform policy:
   * > 24h before slot -> 100% full refund
   * < 24h before slot -> 50% partial refund
   * Doctor cancellation -> 100% full refund always
   */
  async refundPayment(
    paymentId: string,
    reason: string,
    forcedByDoctor = false,
  ) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { appointment: true },
    });

    if (!payment) {
      throw new NotFoundException(`Payment ${paymentId} not found`);
    }

    if (payment.status !== 'CAPTURED') {
      throw new BadRequestException(
        `Cannot refund payment in status ${payment.status}`,
      );
    }

    let refundAmountPaise = payment.amountPaise;

    if (!forcedByDoctor) {
      const hoursUntilSlot =
        (payment.appointment.slotTime.getTime() - Date.now()) / (1000 * 60 * 60);
      if (hoursUntilSlot < 24) {
        // Partial 50% refund policy
        refundAmountPaise = Math.round(payment.amountPaise * 0.5);
      }
    }

    const providerResult = await this.provider.issueRefund({
      paymentId: payment.id,
      providerPaymentId: payment.providerPaymentId || undefined,
      amountPaise: refundAmountPaise,
      reason,
    });

    return this.prisma.$transaction(async (tx) => {
      const refund = await tx.refund.create({
        data: {
          paymentId: payment.id,
          providerRefundId: providerResult.providerRefundId,
          amountPaise: refundAmountPaise,
          reason,
          status: 'PROCESSED',
        },
      });

      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: 'REFUNDED',
        },
      });

      await tx.appointment.update({
        where: { id: payment.appointmentId },
        data: {
          status: 'REFUNDED',
          cancellationReason: reason,
        },
      });

      // Post reversing ledger entries
      await this.ledgerService.recordRefund(
        payment.id,
        refundAmountPaise,
        1000,
        tx,
      );

      await tx.outboxEvent.create({
        data: {
          aggregateType: 'PAYMENT',
          aggregateId: payment.id,
          eventType: 'PAYMENT_REFUNDED',
          payload: {
            paymentId: payment.id,
            refundId: refund.id,
            amountPaise: refundAmountPaise,
            reason,
          },
        },
      });

      return refund;
    });
  }

  /**
   * Periodic reconciliation job: catches stuck PENDING / INITIATED payments
   * older than 15 minutes, checks gateway status and reconciles.
   */
  async reconcileStuckPayments(): Promise<number> {
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    const stuckPayments = await this.prisma.payment.findMany({
      where: {
        status: { in: ['INITIATED', 'PENDING'] },
        createdAt: { lt: fifteenMinutesAgo },
      },
    });

    let reconciledCount = 0;

    for (const p of stuckPayments) {
      try {
        const remote = await this.provider.fetchPaymentStatus(p.providerOrderId);
        if (remote.status === 'CAPTURED') {
          // Process capture retroactively
          await this.prisma.$transaction(async (tx) => {
            await tx.payment.update({
              where: { id: p.id },
              data: {
                status: 'CAPTURED',
                providerPaymentId: remote.providerPaymentId,
              },
            });
            await tx.appointment.update({
              where: { id: p.appointmentId },
              data: { status: 'CONFIRMED' },
            });
            await this.ledgerService.recordPaymentCapture(
              p.id,
              p.amountPaise,
              1000,
              tx,
            );
          });
          reconciledCount++;
        } else if (remote.status === 'FAILED') {
          await this.prisma.payment.update({
            where: { id: p.id },
            data: { status: 'FAILED' },
          });
          reconciledCount++;
        }
      } catch (err) {
        this.logger.error(`Error reconciling payment ${p.id}: ${err}`);
      }
    }

    return reconciledCount;
  }

  async findById(paymentId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        appointment: {
          include: {
            doctor: {
              include: {
                user: { select: { name: true, email: true } },
              },
            },
            patient: { select: { name: true, email: true } },
          },
        },
        refunds: true,
        ledgers: true,
      },
    });
    if (!payment) {
      throw new NotFoundException(`Payment ${paymentId} not found`);
    }
    return payment;
  }

}

