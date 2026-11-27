import * as crypto from 'crypto';
import { Injectable, Optional, Inject } from '@nestjs/common';
import {
  PaymentProvider,
  PaymentOrderResult,
  RefundResult,
  ParsedWebhookEvent,
} from './payment-provider.interface';
import { env } from '../../../common/config/env.schema';
import { RedisService } from '../../platform/redis/redis.service';

@Injectable()
export class FakePaymentProvider implements PaymentProvider {
  readonly name = 'FAKE';
  private readonly webhookSecret: string;
  private orders = new Map<
    string,
    { amountPaise: number; status: 'CAPTURED' | 'PENDING' | 'FAILED'; providerPaymentId?: string }
  >();

  public simulateFailure = false;
  public simulateDelayedWebhook = false;

  constructor(
    @Optional() @Inject(RedisService) private readonly redis?: RedisService,
  ) {
    this.webhookSecret = env.PAYMENT_WEBHOOK_SECRET || env.RAZORPAY_WEBHOOK_SECRET || '';
    if (!this.webhookSecret) {
      throw new Error('PAYMENT_WEBHOOK_SECRET is required for FakePaymentProvider');
    }
  }

  async createOrder(params: {
    appointmentId: string;
    amountPaise: number;
    currency?: string;
  }): Promise<PaymentOrderResult> {
    const providerOrderId = `fake_ord_${crypto.randomUUID().slice(0, 16)}`;
    const record = {
      amountPaise: params.amountPaise,
      status: (this.simulateFailure ? 'FAILED' : 'PENDING') as 'CAPTURED' | 'PENDING' | 'FAILED',
    };
    this.orders.set(providerOrderId, record);

    if (this.redis) {
      try {
        await this.redis.getClient().set(
          `fake:order:${providerOrderId}`,
          JSON.stringify(record),
          'EX',
          86400,
        );
      } catch {
        // Ignore redis cache error in offline test mode
      }
    }

    return {
      providerOrderId,
      amountPaise: params.amountPaise,
      currency: params.currency || 'INR',
    };
  }

  verifyWebhookSignature(rawBody: string | Buffer, signature: string): boolean {
    if (!signature) return false;
    const expected = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(rawBody)
      .digest('hex');

    try {
      return crypto.timingSafeEqual(
        Buffer.from(signature, 'hex'),
        Buffer.from(expected, 'hex'),
      );
    } catch {
      return false;
    }
  }

  generateSignature(rawBody: string | Buffer): string {
    return crypto
      .createHmac('sha256', this.webhookSecret)
      .update(rawBody)
      .digest('hex');
  }

  parseWebhookEvent(rawBody: string | Buffer, headerEventId?: string): ParsedWebhookEvent {
    const bodyStr = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    const json = JSON.parse(bodyStr);

    const paymentEntity = json.payload?.payment?.entity;
    const orderEntity = json.payload?.order?.entity;
    const eventType = String(json.event || '');
    const providerOrderId =
      paymentEntity?.order_id || orderEntity?.id || json.order_id || '';
    const providerPaymentId = paymentEntity?.id || json.payment_id;
    const rawAmount = paymentEntity?.amount ?? orderEntity?.amount ?? json.amount;
    const amountPaise =
      rawAmount !== undefined && rawAmount !== null ? Number(rawAmount) : undefined;
    const rawCurrency =
      paymentEntity?.currency || orderEntity?.currency || json.currency;
    const currency = rawCurrency ? String(rawCurrency).toUpperCase() : undefined;

    let status: 'CAPTURED' | 'FAILED' | 'IGNORED' = 'IGNORED';
    if (eventType === 'payment.captured' || eventType === 'order.paid') {
      status = 'CAPTURED';
    } else if (eventType === 'payment.failed') {
      status = 'FAILED';
    }

    const entityKey =
      providerPaymentId ||
      providerOrderId ||
      crypto.createHash('sha256').update(bodyStr).digest('hex').slice(0, 16);
    const deterministicFallback = `evt_${crypto
      .createHash('sha256')
      .update(`${eventType}:${entityKey}`)
      .digest('hex')
      .slice(0, 24)}`;

    return {
      eventId: headerEventId || json.id || deterministicFallback,
      eventType: eventType || 'unknown',
      providerOrderId,
      providerPaymentId:
        providerPaymentId ||
        (status === 'CAPTURED' ? `fake_pay_${entityKey.slice(0, 12)}` : undefined),
      amountPaise,
      currency,
      status,
      rawPayload: json,
    };
  }

  async issueRefund(params: {
    refundId?: string;
    paymentId: string;
    providerPaymentId?: string;
    amountPaise: number;
    reason?: string;
  }): Promise<RefundResult> {
    return {
      providerRefundId: `fake_rfnd_${crypto.randomUUID().slice(0, 16)}`,
      amountPaise: params.amountPaise,
      status: 'PROCESSED',
    };
  }

  async fetchPaymentStatus(providerOrderId: string): Promise<{
    status: 'CAPTURED' | 'PENDING' | 'FAILED';
    providerPaymentId?: string;
  }> {
    const existing = this.orders.get(providerOrderId);
    if (existing) {
      return {
        status: existing.status,
        providerPaymentId: existing.providerPaymentId,
      };
    }

    if (this.redis) {
      try {
        const raw = await this.redis.getClient().get(`fake:order:${providerOrderId}`);
        if (raw) {
          const parsed = JSON.parse(raw);
          this.orders.set(providerOrderId, parsed);
          return {
            status: parsed.status,
            providerPaymentId: parsed.providerPaymentId,
          };
        }
      } catch {
        // Fallback below
      }
    }

    // Default to PENDING if order is not tracked yet (never falsely mark FAILED on unknown order)
    return { status: 'PENDING' };
  }

  simulateExternalCapture(
    providerOrderId: string,
    providerPaymentId = `fake_pay_${Date.now()}`,
  ): void {
    const record = {
      amountPaise: 0,
      status: 'CAPTURED' as const,
      providerPaymentId,
    };
    const ord = this.orders.get(providerOrderId);
    if (ord) {
      ord.status = 'CAPTURED';
      ord.providerPaymentId = providerPaymentId;
    } else {
      this.orders.set(providerOrderId, record);
    }

    if (this.redis) {
      this.redis.getClient().set(
        `fake:order:${providerOrderId}`,
        JSON.stringify(record),
        'EX',
        86400,
      ).catch(() => {});
    }
  }
}
