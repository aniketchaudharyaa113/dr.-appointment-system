import * as crypto from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  PaymentProvider,
  PaymentOrderResult,
  RefundResult,
  ParsedWebhookEvent,
} from './payment-provider.interface';
import { env } from '../../../common/config/env.schema';

const PROVIDER_FETCH_TIMEOUT_MS = 10_000;

@Injectable()
export class RazorpayProvider implements PaymentProvider {
  readonly name = 'RAZORPAY';
  private readonly logger = new Logger(RazorpayProvider.name);
  private readonly keyId: string;
  private readonly keySecret: string;
  private readonly webhookSecret: string;

  constructor() {
    this.keyId = env.RAZORPAY_KEY_ID || '';
    this.keySecret = env.RAZORPAY_KEY_SECRET || '';
    this.webhookSecret = env.RAZORPAY_WEBHOOK_SECRET || '';
  }

  async createOrder(params: {
    appointmentId: string;
    amountPaise: number;
    currency?: string;
  }): Promise<PaymentOrderResult> {
    const currency = params.currency || 'INR';
    if (!this.keyId || !this.keySecret) {
      throw new Error('RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are required');
    }

    const auth = Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64');
    const response = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(PROVIDER_FETCH_TIMEOUT_MS),
      body: JSON.stringify({
        amount: params.amountPaise,
        currency,
        receipt: `rcpt_${params.appointmentId.slice(0, 20)}`,
        notes: {
          appointmentId: params.appointmentId,
        },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Razorpay order creation failed: ${err}`);
    }

    const data = (await response.json()) as { id: string; amount: number; currency: string };
    return {
      providerOrderId: data.id,
      amountPaise: data.amount,
      currency: data.currency,
    };
  }

  verifyWebhookSignature(rawBody: string | Buffer, signature: string): boolean {
    if (!signature || !this.webhookSecret) return false;
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
      providerPaymentId,
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
    if (!this.keyId || !this.keySecret || !params.providerPaymentId) {
      throw new Error('Razorpay credentials and providerPaymentId required for refund');
    }

    const idempotencyKey = params.refundId || `rfnd_${params.paymentId}`;
    const auth = Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64');
    const response = await fetch(
      `https://api.razorpay.com/v1/payments/${params.providerPaymentId}/refund`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
          'X-Refund-Idempotency': idempotencyKey,
        },
        signal: AbortSignal.timeout(PROVIDER_FETCH_TIMEOUT_MS),
        body: JSON.stringify({
          amount: params.amountPaise,
          notes: {
            refundId: idempotencyKey,
            reason: params.reason || 'Requested by patient or system',
          },
        }),
      },
    );

    if (!response.ok) {
      const err = await response.text();
      this.logger.error(`Razorpay refund failed: ${err}`);
      throw new Error(`Razorpay refund failed: ${err}`);
    }

    const data = (await response.json()) as { id: string; amount: number; status: string };
    return {
      providerRefundId: data.id,
      amountPaise: data.amount,
      status: data.status === 'processed' ? 'PROCESSED' : 'PENDING',
    };
  }

  async fetchPaymentStatus(providerOrderId: string): Promise<{
    status: 'CAPTURED' | 'PENDING' | 'FAILED';
    providerPaymentId?: string;
  }> {
    if (!this.keyId || !this.keySecret) {
      return { status: 'PENDING' };
    }

    const auth = Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64');
    const response = await fetch(
      `https://api.razorpay.com/v1/orders/${encodeURIComponent(providerOrderId)}/payments`,
      {
        method: 'GET',
        headers: {
          Authorization: `Basic ${auth}`,
        },
        signal: AbortSignal.timeout(PROVIDER_FETCH_TIMEOUT_MS),
      },
    );

    if (!response.ok) {
      this.logger.warn(`Razorpay fetchPaymentStatus failed (${response.status}) for ${providerOrderId}`);
      return { status: 'PENDING' };
    }

    const data = (await response.json()) as {
      items?: Array<{ id: string; status: string }>;
    };
    const items = data.items ?? [];
    const captured = items.find((i) => i.status === 'captured');
    if (captured) {
      return { status: 'CAPTURED', providerPaymentId: captured.id };
    }
    if (items.length > 0 && items.every((i) => i.status === 'failed')) {
      return { status: 'FAILED' };
    }
    return { status: 'PENDING' };
  }
}
