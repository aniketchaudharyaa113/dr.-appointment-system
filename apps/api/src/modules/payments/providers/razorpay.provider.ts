import * as crypto from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  PaymentProvider,
  PaymentOrderResult,
  RefundResult,
  ParsedWebhookEvent,
} from './payment-provider.interface';
import { env } from '../../../common/config/env.schema';

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

  parseWebhookEvent(rawBody: string | Buffer): ParsedWebhookEvent {
    const bodyStr = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    const json = JSON.parse(bodyStr);

    const paymentEntity = json.payload?.payment?.entity;
    const providerOrderId = paymentEntity?.order_id || json.order_id || '';
    const providerPaymentId = paymentEntity?.id || json.payment_id;
    const amountPaise = paymentEntity?.amount || json.amount || 0;

    return {
      eventId: json.id || `evt_${crypto.randomUUID().slice(0, 12)}`,
      eventType: json.event || 'payment.captured',
      providerOrderId,
      providerPaymentId,
      amountPaise,
      status: json.event === 'payment.failed' ? 'FAILED' : 'CAPTURED',
      rawPayload: json,
    };
  }

  async issueRefund(params: {
    paymentId: string;
    providerPaymentId?: string;
    amountPaise: number;
    reason?: string;
  }): Promise<RefundResult> {
    if (!this.keyId || !this.keySecret || !params.providerPaymentId) {
      throw new Error('Razorpay credentials and providerPaymentId required for refund');
    }

    const auth = Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64');
    const response = await fetch(
      `https://api.razorpay.com/v1/payments/${params.providerPaymentId}/refund`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: params.amountPaise,
          notes: {
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

  async fetchPaymentStatus(_providerOrderId: string): Promise<{
    status: 'CAPTURED' | 'PENDING' | 'FAILED';
    providerPaymentId?: string;
  }> {
    return { status: 'PENDING' };
  }
}
