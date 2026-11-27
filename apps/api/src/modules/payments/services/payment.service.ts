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
  ) {}

  private serializePayment(p: {
    id: string;
    providerOrderId: string;
    amountPaise: number;
    currency: string;
    status: string;
    provider: string;
  }) {
    return {
      paymentId: p.id,
      providerOrderId: p.providerOrderId,
      amountPaise: p.amountPaise,
      currency: p.currency,
      status: p.status,
      provider: p.provider,
    };
  }

  private async resolveExistingCheckoutByKey(
    patientId: string,
    appointmentId: string,
    idempotencyKey: string,
  ) {
    // 1. Check dedicated idempotency-key registry first (supports retry keys without mutating Payment.idempotencyKey)
    const keyRow = await this.prisma.checkoutIdempotencyKey.findUnique({
      where: { idempotencyKey },
      include: {
        payment: true,
        appointment: { select: { patientId: true } },
      },
    });

    if (keyRow) {
      if (keyRow.appointmentId !== appointmentId) {
        throw new ConflictException(
          'Idempotency key is already bound to a different appointment',
        );
      }
      if (keyRow.appointment.patientId !== patientId) {
        throw new ForbiddenException('Unauthorized payment access');
      }
      return keyRow.payment;
    }

    // 2. Fallback check against legacy Payment.idempotencyKey column
    const legacyPayment = await this.prisma.payment.findUnique({
      where: { idempotencyKey },
      include: { appointment: { select: { patientId: true } } },
    });
    if (legacyPayment) {
      if (legacyPayment.appointmentId !== appointmentId) {
        throw new ConflictException(
          'Idempotency key is already bound to a different appointment',
        );
      }
      if (legacyPayment.appointment.patientId !== patientId) {
        throw new ForbiddenException('Unauthorized payment access');
      }
      return legacyPayment;
    }

    return null;
  }

  /**
   * Initiates payment order for an appointment in PENDING_PAYMENT state.
   * Binds idempotencyKey to appointmentId, caches only { paymentId, appointmentId } in Redis,
   * always returns the live DB Payment row status, creates DB row before external provider order,
   * and preserves original idempotencyKey when resetting a FAILED payment.
   */
  async createCheckout(
    patientId: string,
    appointmentId: string,
    idempotencyKey: string,
  ) {
    const redisIdemKey = `checkout:${patientId}:${idempotencyKey}`;
    const cachedRef = await this.redis.getIdempotency<{
      paymentId: string;
      appointmentId: string;
    }>(redisIdemKey);

    if (cachedRef) {
      if (cachedRef.appointmentId !== appointmentId) {
        throw new ConflictException(
          'Idempotency key is already bound to a different appointment',
        );
      }
      const liveCachedPayment = await this.prisma.payment.findUnique({
        where: { id: cachedRef.paymentId },
        include: { appointment: { select: { patientId: true } } },
      });
      if (liveCachedPayment) {
        if (liveCachedPayment.appointment.patientId !== patientId) {
          throw new ForbiddenException('Unauthorized payment access');
        }
        if (!liveCachedPayment.providerOrderId.startsWith('pending_')) {
          return this.serializePayment(liveCachedPayment);
        }
      }
    }

    const existingByKey = await this.resolveExistingCheckoutByKey(
      patientId,
      appointmentId,
      idempotencyKey,
    );
    if (existingByKey && !existingByKey.providerOrderId.startsWith('pending_')) {
      await this.redis.setIdempotency(
        redisIdemKey,
        { paymentId: existingByKey.id, appointmentId },
        86400,
      );
      return this.serializePayment(existingByKey);
    }

    // Reserve DB row inside transaction FIRST (lock order: appointments -> payments)
    let reservation:
      | { kind: 'EXISTING'; payment: any }
      | { kind: 'NEEDS_ORDER'; paymentId: string; amountPaise: number; currency: string };

    try {
      reservation = await this.prisma.$transaction(async (tx) => {
        const apptRows = await tx.$queryRaw<
          Array<{ id: string; patient_id: string; doctor_id: string; status: string }>
        >`
          SELECT id, patient_id, doctor_id, status
          FROM appointments
          WHERE id = ${appointmentId}::uuid
          FOR UPDATE
        `;
        const appt = apptRows[0];
        if (!appt) {
          throw new NotFoundException(`Appointment ${appointmentId} not found`);
        }
        if (appt.patient_id !== patientId) {
          throw new ForbiddenException('Unauthorized appointment access');
        }
        if (appt.status !== 'PENDING_PAYMENT') {
          throw new ConflictException(
            `Appointment is in state ${appt.status}, cannot checkout`,
          );
        }

        const doctor = await tx.doctor.findUnique({
          where: { id: appt.doctor_id },
          select: { consultationFeePaise: true },
        });
        if (!doctor) {
          throw new NotFoundException(`Doctor ${appt.doctor_id} not found`);
        }

        const payRows = await tx.$queryRaw<
          Array<{
            id: string;
            provider_order_id: string;
            amount_paise: number;
            currency: string;
            status: string;
            provider: string;
          }>
        >`
          SELECT id, provider_order_id, amount_paise, currency, status, provider
          FROM payments
          WHERE appointment_id = ${appointmentId}::uuid
          FOR UPDATE
        `;
        const currentPay = payRows[0];

        if (currentPay) {
          if (currentPay.status === 'CAPTURED') {
            throw new ConflictException('Appointment is already paid and captured');
          }
          if (currentPay.status === 'INITIATED' || currentPay.status === 'PENDING') {
            // Bind new key to active payment row cleanly if absent
            await tx.checkoutIdempotencyKey.upsert({
              where: { idempotencyKey },
              create: {
                idempotencyKey,
                appointmentId,
                paymentId: currentPay.id,
              },
              update: {},
            });
            return {
              kind: 'EXISTING' as const,
              payment: {
                id: currentPay.id,
                providerOrderId: currentPay.provider_order_id,
                amountPaise: currentPay.amount_paise,
                currency: currentPay.currency,
                status: currentPay.status,
                provider: currentPay.provider,
              },
            };
          }

          // FAILED payment reset: preserve original Payment.idempotencyKey & reserve pending order state
          const pendingOrderId = `pending_${crypto.randomUUID().slice(0, 20)}`;
          await tx.payment.update({
            where: { id: currentPay.id },
            data: {
              provider: this.provider.name,
              providerOrderId: pendingOrderId,
              providerPaymentId: null,
              amountPaise: doctor.consultationFeePaise,
              status: 'PENDING',
            },
          });

          await tx.checkoutIdempotencyKey.upsert({
            where: { idempotencyKey },
            create: {
              idempotencyKey,
              appointmentId,
              paymentId: currentPay.id,
            },
            update: {},
          });

          return {
            kind: 'NEEDS_ORDER' as const,
            paymentId: currentPay.id,
            amountPaise: doctor.consultationFeePaise,
            currency: currentPay.currency || 'INR',
          };
        }

        // First checkout for this appointment: insert DB payment + idempotency key FIRST
        const pendingOrderId = `pending_${crypto.randomUUID().slice(0, 20)}`;
        const created = await tx.payment.create({
          data: {
            appointmentId,
            provider: this.provider.name,
            providerOrderId: pendingOrderId,
            amountPaise: doctor.consultationFeePaise,
            currency: 'INR',
            status: 'PENDING',
            idempotencyKey,
          },
        });

        await tx.checkoutIdempotencyKey.create({
          data: {
            idempotencyKey,
            appointmentId,
            paymentId: created.id,
          },
        });

        return {
          kind: 'NEEDS_ORDER' as const,
          paymentId: created.id,
          amountPaise: doctor.consultationFeePaise,
          currency: 'INR',
        };
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        const raced = await this.resolveExistingCheckoutByKey(
          patientId,
          appointmentId,
          idempotencyKey,
        );
        if (raced) {
          return this.serializePayment(raced);
        }
        throw new ConflictException('Concurrent checkout request in progress');
      }
      throw err;
    }

    if (reservation.kind === 'EXISTING') {
      const res = this.serializePayment(reservation.payment);
      await this.redis.setIdempotency(
        redisIdemKey,
        { paymentId: res.paymentId, appointmentId },
        86400,
      );
      return res;
    }

    // Create provider order AFTER DB reservation succeeds; rollback reservation to FAILED if provider call fails
    let order;
    try {
      order = await this.provider.createOrder({
        appointmentId,
        amountPaise: reservation.amountPaise,
        currency: reservation.currency,
      });
    } catch (err) {
      await this.prisma.payment.update({
        where: { id: reservation.paymentId },
        data: { status: 'FAILED' },
      });
      throw err;
    }

    const updated = await this.prisma.payment.update({
      where: { id: reservation.paymentId },
      data: {
        providerOrderId: order.providerOrderId,
        amountPaise: order.amountPaise,
        currency: order.currency,
        status: 'INITIATED',
      },
    });

    await this.redis.setIdempotency(
      redisIdemKey,
      { paymentId: updated.id, appointmentId },
      86400,
    );

    return this.serializePayment(updated);
  }

  getPublicConfig() {
    return {
      provider: this.provider.name,
      simulatorEnabled:
        env.NODE_ENV !== 'production' &&
        env.PAYMENT_PROVIDER === 'FAKE' &&
        env.ENABLE_DEV_ENDPOINTS,
      keyId: env.RAZORPAY_KEY_ID || undefined,
    };
  }

  /**
   * Processes incoming webhook from payment provider.
   * Global lock order (B8): appointments FIRST, then payments, then refunds.
   */
  async processWebhook(
    rawBody: string | Buffer,
    signature: string,
    headerEventId?: string,
  ) {
    if (!rawBody || (Buffer.isBuffer(rawBody) && rawBody.length === 0)) {
      throw new BadRequestException('Raw webhook body is required');
    }

    const isValid = this.provider.verifyWebhookSignature(rawBody, signature);
    if (!isValid) {
      this.logger.warn('Rejected payment webhook due to invalid HMAC signature');
      throw new BadRequestException('Invalid webhook signature');
    }

    const parsed = this.provider.parseWebhookEvent(rawBody, headerEventId);

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

      if (parsed.status === 'IGNORED') {
        await tx.paymentEvent.update({
          where: { providerEventId: parsed.eventId },
          data: { status: 'IGNORED', processedAt: new Date() },
        });
        return {
          status: 'IGNORED',
          eventType: parsed.eventType,
          eventId: parsed.eventId,
        };
      }

      // Lookup appointmentId without lock first so global lock order (appointments -> payments) holds
      const lookup = await tx.payment.findUnique({
        where: { providerOrderId: parsed.providerOrderId },
        select: { id: true, appointmentId: true },
      });

      if (!lookup) {
        this.logger.warn(
          `Payment record not found for providerOrderId: ${parsed.providerOrderId}`,
        );
        await tx.paymentEvent.update({
          where: { providerEventId: parsed.eventId },
          data: { status: 'ORDER_NOT_FOUND', processedAt: new Date() },
        });
        return { status: 'ORDER_NOT_FOUND' };
      }

      // Lock appointment FIRST
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
        WHERE id = ${lookup.appointmentId}::uuid
        FOR UPDATE
      `;

      // Lock payment SECOND
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
        WHERE id = ${lookup.id}::uuid
        FOR UPDATE
      `;

      const payment = paymentRows[0];
      if (!payment) {
        await tx.paymentEvent.update({
          where: { providerEventId: parsed.eventId },
          data: { status: 'ORDER_NOT_FOUND', processedAt: new Date() },
        });
        return { status: 'ORDER_NOT_FOUND' };
      }

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

      // If webhook payload legitimately omits amount, fall back to stored payment.amount_paise
      const expectedCurrency = payment.currency.toUpperCase();
      const receivedCurrency = (parsed.currency || expectedCurrency).toUpperCase();
      const effectiveAmount =
        parsed.amountPaise !== undefined ? parsed.amountPaise : payment.amount_paise;
      const amountMismatch = effectiveAmount !== payment.amount_paise;
      const currencyMismatch = receivedCurrency !== expectedCurrency;

      if (amountMismatch || currencyMismatch) {
        this.logger.error(
          `Payment ${payment.id} amount/currency mismatch: expected ${payment.amount_paise} ${expectedCurrency}, got ${effectiveAmount} ${receivedCurrency}`,
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
        appointment: apptRows[0],
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
      appointment?: {
        id: string;
        patient_id: string;
        doctor_id: string;
        slot_time: Date;
        booking_ref: string | null;
        status: string;
      };
      providerPaymentId: string;
    },
  ) {
    const { payment, providerPaymentId } = params;

    let appointment = params.appointment;
    if (!appointment) {
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
      appointment = apptRows[0];
    }

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
   * Atomically records a refund inside a transaction following global lock order
   * (appointments -> payments -> refunds), frees the slot for waitlist, closes consultation session,
   * and clears cache:next_slot after commit.
   */
  async refundPayment(
    paymentId: string,
    reason: string,
    actorId: string,
    actorRole: string,
  ) {
    const paymentRef = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      select: { id: true, appointmentId: true },
    });
    if (!paymentRef) {
      throw new NotFoundException(`Payment ${paymentId} not found`);
    }

    const { refund, doctorId } = await this.prisma.$transaction(async (tx) => {
      // Lock appointment FIRST
      const apptRows = await tx.$queryRaw<
        Array<{
          id: string;
          patient_id: string;
          doctor_id: string;
          slot_time: Date;
          status: string;
        }>
      >`
        SELECT id, patient_id, doctor_id, slot_time, status
        FROM appointments
        WHERE id = ${paymentRef.appointmentId}::uuid
        FOR UPDATE
      `;
      const lockedAppt = apptRows[0];
      if (!lockedAppt) {
        throw new NotFoundException('Appointment not found for payment');
      }

      // Lock payment SECOND
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

      const doctor = await tx.doctor.findUnique({
        where: { id: lockedAppt.doctor_id },
        select: { userId: true },
      });

      const isOwner = lockedAppt.patient_id === actorId;
      const isDoctor = doctor?.userId === actorId;
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
        status: lockedAppt.status,
        slotTime: new Date(lockedAppt.slot_time),
        actorRole,
      });

      const { refundAmountPaise } = this.refundPolicy.calculateRefundAmountPaise({
        amountPaise: payment.amount_paise,
        slotTime: new Date(lockedAppt.slot_time),
        initiatedBy: isAdmin ? 'ADMIN' : isDoctor ? 'DOCTOR' : 'PATIENT',
      });

      await tx.appointment.update({
        where: { id: lockedAppt.id },
        data: {
          status: 'REFUNDED',
          cancellationReason: reason,
        },
      });

      await tx.consultationSession.updateMany({
        where: {
          appointmentId: lockedAppt.id,
          status: { not: 'ENDED' },
        },
        data: {
          status: 'ENDED',
          endedAt: new Date(),
        },
      });

      await tx.outboxEvent.create({
        data: {
          aggregateType: 'APPOINTMENT',
          aggregateId: lockedAppt.id,
          eventType: 'AppointmentCancelled',
          payload: {
            appointmentId: lockedAppt.id,
            doctorId: lockedAppt.doctor_id,
            patientId: lockedAppt.patient_id,
            slotTime: new Date(lockedAppt.slot_time).toISOString(),
            reason,
          },
        },
      });

      await tx.outboxEvent.create({
        data: {
          aggregateType: 'APPOINTMENT',
          aggregateId: lockedAppt.id,
          eventType: 'AppointmentSlotFreed',
          payload: {
            appointmentId: lockedAppt.id,
            doctorId: lockedAppt.doctor_id,
            slotTime: new Date(lockedAppt.slot_time).toISOString(),
          },
        },
      });

      const recordedRefund = await this.refundPolicy.recordRefundInTx(tx, {
        paymentId: payment.id,
        appointmentId: lockedAppt.id,
        providerPaymentId: payment.provider_payment_id,
        refundAmountPaise,
        reason,
      });

      return { refund: recordedRefund, doctorId: lockedAppt.doctor_id };
    });

    await this.redis.getClient().del(`cache:next_slot:${doctorId}`);
    return refund;
  }

  /**
   * Idempotent post-commit refund execution against the payment provider.
   * Atomically claims PENDING/FAILED -> IN_FLIGHT before invoking provider.
   */
  async executePendingRefund(refundId: string) {
    const claim = await this.prisma.refund.updateMany({
      where: {
        id: refundId,
        status: { in: ['PENDING', 'FAILED'] },
      },
      data: {
        status: 'IN_FLIGHT',
        lastError: null,
      },
    });

    const refund = await this.prisma.refund.findUnique({
      where: { id: refundId },
      include: { payment: true },
    });

    if (!refund) {
      throw new NotFoundException(`Refund ${refundId} not found`);
    }

    if (claim.count === 0) {
      return refund;
    }

    try {
      const providerResult = await this.provider.issueRefund({
        refundId: refund.id,
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
          lastError: null,
        },
      });
    } catch (err: any) {
      await this.prisma.refund.update({
        where: { id: refund.id },
        data: {
          status: 'FAILED',
          lastError: err?.message ? String(err.message).slice(0, 1000) : 'Refund failed',
        },
      });
      throw err;
    }
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
   * Preserves global lock order (appointments -> payments).
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
          const outcome = await this.prisma.$transaction(async (tx) => {
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
              WHERE id = ${p.appointmentId}::uuid
              FOR UPDATE
            `;
            const locked = await tx.$queryRaw<
              Array<{ id: string; appointment_id: string; amount_paise: number; status: string }>
            >`
              SELECT id, appointment_id, amount_paise, status
              FROM payments
              WHERE id = ${p.id}::uuid
              FOR UPDATE
            `;
            const cur = locked[0];
            if (!cur || cur.status === 'CAPTURED' || cur.status === 'REFUNDED') {
              return { status: 'NOOP' };
            }
            return this.applyCaptureInTx(tx, {
              payment: cur,
              appointment: apptRows[0],
              providerPaymentId:
                remote.providerPaymentId || `rec_${crypto.randomUUID().slice(0, 12)}`,
            });
          });
          if (outcome.status === 'CAPTURED' || outcome.status === 'AUTO_REFUNDED') {
            reconciledCount++;
          }
        } else if (remote.status === 'FAILED') {
          const updated = await this.prisma.$transaction(async (tx) => {
            await tx.$queryRaw`
              SELECT id FROM appointments WHERE id = ${p.appointmentId}::uuid FOR UPDATE
            `;
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
