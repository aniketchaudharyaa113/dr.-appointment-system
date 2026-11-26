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
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../platform/database/prisma.service';
import { RedisService } from '../../platform/redis/redis.service';
import {
  PaymentProvider,
  PAYMENT_PROVIDER,
} from '../providers/payment-provider.interface';
import { FakePaymentProvider } from '../providers/fake.provider';
import { LedgerService } from './ledger.service';
import { RefundPolicyService } from './refund-policy.service';
import { RealtimeService } from '../../platform/realtime/realtime.service';
import { env } from '../../../common/config/env.schema';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(LedgerService) private readonly ledgerService: LedgerService,
    @Inject(RefundPolicyService) private readonly refundPolicy: RefundPolicyService,
    @Inject(RealtimeService) private readonly realtime: RealtimeService,
  ) { }

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

    const existingPaymentId =
      appointment.payment?.status === 'FAILED' ? appointment.payment.id : null;

    const payment = await this.prisma.$transaction(async (tx) => {
      if (existingPaymentId) {
        await tx.$queryRaw`
          SELECT id FROM payments WHERE id = ${existingPaymentId}::uuid FOR UPDATE
        `;
        return tx.payment.update({
          where: { id: existingPaymentId },
          data: {
            provider: this.provider.name,
            providerOrderId: order.providerOrderId,
            providerPaymentId: null,
            amountPaise,
            currency: order.currency,
            status: 'INITIATED',
            idempotencyKey,
          },
        });
      }

      return tx.payment.create({
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

  getPublicConfig() {
    return {
      provider: this.provider.name,
      simulatorEnabled:
        env.NODE_ENV !== 'production' && env.PAYMENT_PROVIDER === 'FAKE',
    };
  }

  /**
   * Processes incoming webhook from payment provider.
   * Verifies HMAC signature on exact raw bytes, stores in inbox with UNIQUE(provider_event_id)
   * inside the same transaction (so crashes before commit or stuck PENDING events can be retried),
   * performs SELECT ... FOR UPDATE row locks on payment & appointment,
   * verifies amount & currency, and posts double-entry ledger + outbox events in one atomic transaction.
   */
  async processWebhook(
    rawBody: string | Buffer,
    signature: string,
    headerEventId?: string,
  ) {
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
    const parsed = this.provider.parseWebhookEvent(rawBody, headerEventId);

    // 3. Inbox insert + payment/appointment processing in ONE atomic transaction
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        INSERT INTO payment_events (provider_event_id, event_type, payload, status)
        VALUES (${parsed.eventId}, ${parsed.eventType}, ${JSON.stringify(parsed.rawPayload)}::jsonb, 'PENDING')
        ON CONFLICT (provider_event_id) DO NOTHING
      `;

      const eventRows = await tx.$queryRaw<Array<{ status: string }>>`
        SELECT status
        FROM payment_events
        WHERE provider_event_id = ${parsed.eventId}
        FOR UPDATE
      `;
      const eventRow = eventRows[0];
      if (eventRow && eventRow.status !== 'PENDING') {
        this.logger.log(
          `Duplicate webhook event ${parsed.eventId} (status=${eventRow.status}), treating as no-op`,
        );
        return { status: 'DUPLICATE_NOOP', eventId: parsed.eventId };
      }

      const paymentRows = await tx.$queryRaw<
        Array<{
          id: string;
          appointment_id: string;
          amount_paise: number;
          currency: string;
          status: string;
          provider_payment_id: string | null;
        }>
      >`
        SELECT id, appointment_id, amount_paise, currency, status, provider_payment_id
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

      // Amount & currency verification before confirming
      const expectedCurrency = payment.currency.toUpperCase();
      const receivedCurrency = (parsed.currency || expectedCurrency).toUpperCase();
      const amountMismatch =
        parsed.amountPaise !== undefined &&
        parsed.amountPaise !== payment.amount_paise;
      const currencyMismatch = receivedCurrency !== expectedCurrency;

      if (amountMismatch || currencyMismatch) {
        this.logger.error(
          `Payment ${payment.id} amount/currency mismatch: expected ${payment.amount_paise} ${expectedCurrency}, got ${parsed.amountPaise} ${receivedCurrency}`,
        );
        await tx.paymentEvent.update({
          where: { providerEventId: parsed.eventId },
          data: { status: 'AMOUNT_MISMATCH', processedAt: new Date() },
        });
        return {
          status: 'MANUAL_REVIEW_REQUIRED',
          reason: 'AMOUNT_OR_CURRENCY_MISMATCH',
          paymentId: payment.id,
        };
      }

      const captureResult = await this.applyCaptureInTx(tx, {
        payment,
        providerPaymentId: parsed.providerPaymentId || '',
      });

      await tx.paymentEvent.update({
        where: { providerEventId: parsed.eventId },
        data: {
          status:
            captureResult.status === 'AUTO_REFUNDED'
              ? 'AUTO_REFUNDED'
              : 'PROCESSED',
          processedAt: new Date(),
        },
      });

      return captureResult;
    });

    if (result.status === 'CAPTURED' && (result as any).patientId) {
      this.realtime.emitToUser((result as any).patientId, 'booking_updated', {
        appointmentId: (result as any).appointmentId,
        paymentId: (result as any).paymentId,
        status: 'CONFIRMED',
      });
    }

    return result;
  }

  private async applyCaptureInTx(
    tx: Prisma.TransactionClient,
    params: {
      payment: {
        id: string;
        appointment_id: string;
        amount_paise: number;
      };
      providerPaymentId: string;
    },
  ) {
    const { payment, providerPaymentId } = params;

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
          providerPaymentId,
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

      await this.ledgerService.recordPaymentCapture(
        payment.id,
        payment.amount_paise,
        this.ledgerService.commissionBps,
        tx,
      );
      await this.ledgerService.recordRefund(
        payment.id,
        payment.amount_paise,
        this.ledgerService.commissionBps,
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
            providerPaymentId,
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

    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: 'CAPTURED',
        providerPaymentId,
      },
    });

    await tx.appointment.update({
      where: { id: appointment.id },
      data: {
        status: 'CONFIRMED',
      },
    });

    await this.ledgerService.recordPaymentCapture(
      payment.id,
      payment.amount_paise,
      this.ledgerService.commissionBps,
      tx,
    );

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
          providerPaymentId,
        },
      },
    });

    return {
      status: 'CAPTURED',
      paymentId: payment.id,
      appointmentId: appointment.id,
      patientId: appointment.patient_id,
    };
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

      this.refundPolicy.assertRefundableAppointment({
        status: appointment.status,
        slotTime: appointment.slotTime,
        actorRole,
      });

      const { refundAmountPaise } = this.refundPolicy.calculateRefundAmountPaise({
        amountPaise: payment.amount_paise,
        slotTime: appointment.slotTime,
        initiatedBy: isAdmin ? 'ADMIN' : isDoctor ? 'DOCTOR' : 'PATIENT',
      });

      await tx.appointment.update({
        where: { id: payment.appointment_id },
        data: {
          status: 'REFUNDED',
          cancellationReason: reason,
        },
      });

      return this.refundPolicy.recordRefundInTx(tx, {
        paymentId: payment.id,
        appointmentId: appointment.id,
        providerPaymentId: payment.provider_payment_id,
        refundAmountPaise,
        reason,
      });
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
          let captureResult: Awaited<ReturnType<PaymentService['applyCaptureInTx']>> | null =
            null;
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
            captureResult = await this.applyCaptureInTx(tx, {
              payment: cur,
              providerPaymentId: remote.providerPaymentId || `reconcile_${p.id}`,
            });
          });
          if (captureResult) {
            if (
              (captureResult as any).status === 'CAPTURED' &&
              (captureResult as any).patientId
            ) {
              this.realtime.emitToUser(
                (captureResult as any).patientId,
                'booking_updated',
                {
                  appointmentId: (captureResult as any).appointmentId,
                  paymentId: (captureResult as any).paymentId,
                  status: 'CONFIRMED',
                },
              );
            }
            reconciledCount++;
          }
        } else if (remote.status === 'FAILED') {
          const updated = await this.prisma.$transaction(async (tx) => {
            const locked = await tx.$queryRaw<Array<{ id: string; status: string }>>`
              SELECT id, status FROM payments WHERE id = ${p.id}::uuid FOR UPDATE
            `;
            const cur = locked[0];
            if (!cur || cur.status === 'CAPTURED' || cur.status === 'REFUNDED' || cur.status === 'FAILED') {
              return false;
            }
            await tx.payment.update({
              where: { id: p.id },
              data: { status: 'FAILED' },
            });
            return true;
          });
          if (updated) {
            reconciledCount++;
          }
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

    if (!isAdmin) {
      return {
        ...payment,
        ledgers: undefined,
      };
    }

    return payment;
  }
}
