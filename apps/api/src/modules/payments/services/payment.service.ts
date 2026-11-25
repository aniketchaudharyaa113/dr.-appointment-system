import {
  Injectable,
  Inject,
  Logger,
  BadRequestException,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../platform/database/prisma.service';
import { RedisService } from '../../platform/redis/redis.service';
import {
  PaymentProvider,
  PAYMENT_PROVIDER,
} from '../providers/payment-provider.interface';
import { FakePaymentProvider } from '../providers/fake.provider';
import { LedgerService } from './ledger.service';
import { env } from '../../../common/config/env.schema';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(LedgerService) private readonly ledgerService: LedgerService,
  ) {}

  /**
   * Initiates payment order for an appointment in PENDING_PAYMENT state.
   */
  async createCheckout(
    patientId: string,
    appointmentId: string,
    idempotencyKey: string,
  ) {
    const redisIdemKey = `checkout:${patientId}:${idempotencyKey}`;
    const cached = await this.redis.getIdempotency<any>(redisIdemKey);
    if (cached) {
      return cached;
    }

    const existingPayment = await this.prisma.payment.findUnique({
      where: { idempotencyKey },
      include: { appointment: true },
    });

    if (existingPayment) {
      if (existingPayment.appointment.patientId !== patientId) {
        throw new ForbiddenException('Unauthorized payment access');
      }
      const res = {
        paymentId: existingPayment.id,
        providerOrderId: existingPayment.providerOrderId,
        amountPaise: existingPayment.amountPaise,
        currency: existingPayment.currency,
        status: existingPayment.status,
        provider: existingPayment.provider,
      };
      await this.redis.setIdempotency(redisIdemKey, res, 86400);
      return res;
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
      throw new ForbiddenException('Unauthorized appointment access');
    }

    if (appointment.status !== 'PENDING_PAYMENT') {
      throw new ConflictException(
        `Appointment is in state ${appointment.status}, cannot checkout`,
      );
    }

    if (appointment.payment) {
      if (appointment.payment.status === 'CAPTURED') {
        throw new ConflictException('Appointment is already paid and captured');
      }
      if (
        appointment.payment.status === 'INITIATED' ||
        appointment.payment.status === 'PENDING'
      ) {
        const res = {
          paymentId: appointment.payment.id,
          providerOrderId: appointment.payment.providerOrderId,
          amountPaise: appointment.payment.amountPaise,
          currency: appointment.payment.currency,
          status: appointment.payment.status,
          provider: appointment.payment.provider,
        };
        await this.redis.setIdempotency(redisIdemKey, res, 86400);
        return res;
      }
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

    const res = {
      paymentId: payment.id,
      providerOrderId: payment.providerOrderId,
      amountPaise: payment.amountPaise,
      currency: payment.currency,
      status: payment.status,
      provider: payment.provider,
    };

    await this.redis.setIdempotency(redisIdemKey, res, 86400);
    return res;
  }

  /**
   * Processes incoming webhook from payment provider.
   * Verifies HMAC signature on exact raw bytes, stores in inbox with UNIQUE(provider_event_id),
   * performs SELECT ... FOR UPDATE row locks on payment & appointment,
   * posts double-entry ledger + outbox events in one atomic transaction.
   */
  async processWebhook(rawBody: string | Buffer, signature: string) {
    if (!rawBody || (Buffer.isBuffer(rawBody) && rawBody.length === 0)) {
      throw new BadRequestException('Raw webhook body is required');
    }

    // 1. Signature Verification on exact raw bytes
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
      if (err.code === 'P2002' || err.message?.includes('duplicate key')) {
        this.logger.log(
          `Duplicate webhook event ${parsed.eventId} received, treating as no-op`,
        );
        return { status: 'DUPLICATE_NOOP', eventId: parsed.eventId };
      }
      throw err;
    }

    // 4. Process event in ONE DB transaction with FOR UPDATE row locks
    return this.prisma.$transaction(async (tx) => {
      const paymentRows = await tx.$queryRaw<
        Array<{
          id: string;
          appointment_id: string;
          amount_paise: number;
          status: string;
          provider_payment_id: string | null;
        }>
      >`
        SELECT id, appointment_id, amount_paise, status, provider_payment_id
        FROM payments
        WHERE provider_order_id = ${parsed.providerOrderId}
        FOR UPDATE
      `;

      const payment = paymentRows[0];
      if (!payment) {
        this.logger.warn(
          `Payment record not found for providerOrderId: ${parsed.providerOrderId}`,
        );
        await tx.paymentEvent.update({
          where: { providerEventId: parsed.eventId },
          data: { status: 'ORDER_NOT_FOUND', processedAt: new Date() },
        });
        return { status: 'ORDER_NOT_FOUND' };
      }

      const apptRows = await tx.$queryRaw<
        Array<{
          id: string;
          patient_id: string;
          doctor_id: string;
          slot_time: Date;
          booking_ref: string | null;
          status: string;
        }>
      >`
        SELECT id, patient_id, doctor_id, slot_time, booking_ref, status
        FROM appointments
        WHERE id = ${payment.appointment_id}::uuid
        FOR UPDATE
      `;
      const appointment = apptRows[0];

      // Idempotency inside lock
      if (payment.status === 'CAPTURED' || payment.status === 'REFUNDED') {
        await tx.paymentEvent.update({
          where: { providerEventId: parsed.eventId },
          data: { status: 'PROCESSED', processedAt: new Date() },
        });
        return { status: 'ALREADY_CAPTURED', paymentId: payment.id };
      }

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

      // 5. Late payment after slot loss / expiry check
      const isSlotLost =
        !appointment ||
        appointment.status === 'CANCELLED' ||
        appointment.status === 'REFUNDED';

      if (isSlotLost) {
        this.logger.warn(
          `Late payment detected for lost/expired appointment ${payment.appointment_id}. Recording auto-refund.`,
        );

        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: 'REFUNDED',
            providerPaymentId: parsed.providerPaymentId,
          },
        });

        const refund = await tx.refund.create({
          data: {
            paymentId: payment.id,
            amountPaise: payment.amount_paise,
            reason: 'AUTO_REFUND_LATE_PAYMENT',
            status: 'PENDING',
          },
        });

        // Balance capture + immediate refund reversal in double-entry ledger
        await this.ledgerService.recordPaymentCapture(
          payment.id,
          payment.amount_paise,
          1000,
          tx,
        );
        await this.ledgerService.recordRefund(
          payment.id,
          payment.amount_paise,
          1000,
          tx,
        );

        await tx.paymentEvent.update({
          where: { providerEventId: parsed.eventId },
          data: { status: 'AUTO_REFUNDED', processedAt: new Date() },
        });

        await tx.outboxEvent.create({
          data: {
            aggregateType: 'PAYMENT',
            aggregateId: payment.id,
            eventType: 'PAYMENT_REFUND_REQUESTED',
            payload: {
              refundId: refund.id,
              paymentId: payment.id,
              providerPaymentId: parsed.providerPaymentId,
              amountPaise: payment.amount_paise,
              reason: 'AUTO_REFUND_LATE_PAYMENT',
            },
          },
        });

        await tx.outboxEvent.create({
          data: {
            aggregateType: 'PAYMENT',
            aggregateId: payment.id,
            eventType: 'PAYMENT_AUTO_REFUNDED',
            payload: {
              paymentId: payment.id,
              refundId: refund.id,
              appointmentId: payment.appointment_id,
              amountPaise: payment.amount_paise,
              reason: 'LATE_PAYMENT_SLOT_LOST',
            },
          },
        });

        return {
          status: 'AUTO_REFUNDED',
          reason: 'SLOT_EXPIRED_OR_LOST',
          paymentId: payment.id,
          refundId: refund.id,
        };
      }

      // 6. Normal capture flow: Update payment & confirm appointment atomically
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
        payment.amount_paise,
        1000,
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
            patientId: appointment.patient_id,
            doctorId: appointment.doctor_id,
            slotTime: new Date(appointment.slot_time).toISOString(),
            bookingRef: appointment.booking_ref,
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
            amountPaise: payment.amount_paise,
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
   * Atomically records a refund inside a transaction with FOR UPDATE row lock,
   * authorization check (owner/doctor/admin), and status check.
   * Provider refund API call happens after commit via the outbox (idempotent).
   */
  async refundPayment(
    paymentId: string,
    reason: string,
    actorId: string,
    actorRole: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const paymentRows = await tx.$queryRaw<
        Array<{
          id: string;
          appointment_id: string;
          amount_paise: number;
          status: string;
          provider_payment_id: string | null;
        }>
      >`
        SELECT id, appointment_id, amount_paise, status, provider_payment_id
        FROM payments
        WHERE id = ${paymentId}::uuid
        FOR UPDATE
      `;

      const payment = paymentRows[0];
      if (!payment) {
        throw new NotFoundException(`Payment ${paymentId} not found`);
      }

      const appointment = await tx.appointment.findUnique({
        where: { id: payment.appointment_id },
        include: { doctor: true },
      });
      if (!appointment) {
        throw new NotFoundException('Appointment not found for payment');
      }

      const isOwner = appointment.patientId === actorId;
      const isDoctor = appointment.doctor.userId === actorId;
      const isAdmin = actorRole === 'ADMIN';
      if (!isOwner && !isDoctor && !isAdmin) {
        throw new ForbiddenException('Not authorized to refund this payment');
      }

      if (payment.status !== 'CAPTURED') {
        throw new BadRequestException(
          `Cannot refund payment in status ${payment.status}`,
        );
      }

      let refundAmountPaise = payment.amount_paise;
      if (!isDoctor && !isAdmin) {
        const hoursUntilSlot =
          (appointment.slotTime.getTime() - Date.now()) / (1000 * 60 * 60);
        if (hoursUntilSlot < 24) {
          refundAmountPaise = Math.round(payment.amount_paise * 0.5);
        }
      }

      const refund = await tx.refund.create({
        data: {
          paymentId: payment.id,
          amountPaise: refundAmountPaise,
          reason,
          status: 'PENDING',
        },
      });

      await tx.payment.update({
        where: { id: payment.id },
        data: { status: 'REFUNDED' },
      });

      await tx.appointment.update({
        where: { id: payment.appointment_id },
        data: {
          status: 'REFUNDED',
          cancellationReason: reason,
        },
      });

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
          eventType: 'PAYMENT_REFUND_REQUESTED',
          payload: {
            refundId: refund.id,
            paymentId: payment.id,
            providerPaymentId: payment.provider_payment_id,
            amountPaise: refundAmountPaise,
            reason,
          },
        },
      });

      await tx.outboxEvent.create({
        data: {
          aggregateType: 'PAYMENT',
          aggregateId: payment.id,
          eventType: 'PAYMENT_REFUNDED',
          payload: {
            paymentId: payment.id,
            refundId: refund.id,
            appointmentId: appointment.id,
            patientId: appointment.patientId,
            amountPaise: refundAmountPaise,
            reason,
          },
        },
      });

      return refund;
    });
  }

  /**
   * Idempotent post-commit refund execution against the payment provider.
   * Invoked by the worker outbox processor (or reconciliation).
   */
  async executePendingRefund(refundId: string) {
    const refund = await this.prisma.refund.findUnique({
      where: { id: refundId },
      include: { payment: true },
    });

    if (!refund) {
      throw new NotFoundException(`Refund ${refundId} not found`);
    }

    if (refund.status === 'PROCESSED' && refund.providerRefundId) {
      return refund;
    }

    const providerResult = await this.provider.issueRefund({
      paymentId: refund.paymentId,
      providerPaymentId: refund.payment.providerPaymentId || undefined,
      amountPaise: refund.amountPaise,
      reason: refund.reason || 'Refund requested',
    });

    return this.prisma.refund.update({
      where: { id: refund.id },
      data: {
        providerRefundId: providerResult.providerRefundId,
        status: providerResult.status === 'PROCESSED' ? 'PROCESSED' : 'PENDING',
      },
    });
  }

  /**
   * Dev/Sandbox-only helper: constructs a Razorpay-style payload, signs raw JSON
   * with the FakePaymentProvider HMAC secret, and processes it as a real webhook.
   */
  async devSimulateWebhook(params: {
    paymentId?: string;
    providerOrderId?: string;
    event: 'payment.captured' | 'payment.failed';
    actorId: string;
    actorRole: string;
  }) {
    if (env.PAYMENT_PROVIDER !== 'FAKE') {
      throw new ForbiddenException(
        'Webhook simulation endpoint is only enabled when PAYMENT_PROVIDER=FAKE',
      );
    }

    const payment = params.paymentId
      ? await this.prisma.payment.findUnique({
          where: { id: params.paymentId },
          include: { appointment: true },
        })
      : await this.prisma.payment.findUnique({
          where: { providerOrderId: params.providerOrderId },
          include: { appointment: true },
        });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    if (
      payment.appointment.patientId !== params.actorId &&
      params.actorRole !== 'ADMIN'
    ) {
      throw new ForbiddenException('Not authorized to simulate payment for this order');
    }

    const eventPayload = {
      id: `evt_sim_${crypto.randomUUID().slice(0, 12)}`,
      event: params.event,
      payload: {
        payment: {
          entity: {
            id: `pay_sim_${crypto.randomUUID().slice(0, 12)}`,
            order_id: payment.providerOrderId,
            amount: payment.amountPaise,
            currency: payment.currency,
          },
        },
      },
    };

    const rawBody = Buffer.from(JSON.stringify(eventPayload), 'utf8');
    const fakeProvider = this.provider as FakePaymentProvider;
    const signature = fakeProvider.generateSignature(rawBody);

    return this.processWebhook(rawBody, signature);
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
          await this.prisma.$transaction(async (tx) => {
            const locked = await tx.$queryRaw<
              Array<{ id: string; status: string; appointment_id: string; amount_paise: number }>
            >`
              SELECT id, status, appointment_id, amount_paise
              FROM payments
              WHERE id = ${p.id}::uuid
              FOR UPDATE
            `;
            const cur = locked[0];
            if (!cur || cur.status === 'CAPTURED' || cur.status === 'REFUNDED') {
              return;
            }
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

  async findById(paymentId: string, actorId: string, actorRole: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        appointment: {
          include: {
            doctor: {
              include: {
                user: { select: { id: true, name: true, email: true } },
              },
            },
            patient: { select: { id: true, name: true, email: true } },
          },
        },
        refunds: true,
        ledgers: true,
      },
    });

    if (!payment) {
      throw new NotFoundException(`Payment ${paymentId} not found`);
    }

    const isOwner = payment.appointment.patientId === actorId;
    const isDoctor = payment.appointment.doctor.userId === actorId;
    const isAdmin = actorRole === 'ADMIN';

    if (!isOwner && !isDoctor && !isAdmin) {
      throw new ForbiddenException('Not authorized to view this payment');
    }

    return payment;
  }
}
