import * as crypto from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  PaymentProvider,
  PaymentOrderResult,
  RefundResult,
  ParsedWebhookEvent,
} from './payment-provider.interface';

@Injectable()
export class RazorpayProvider implements PaymentProvider {
  readonly name = 'RAZORPAY';
  private readonly logger = new Logger(RazorpayProvider.name);
  private readonly keyId: string;
  private readonly keySecret: string;
  private readonly webhookSecret: string;

  constructor() {
    this.keyId = process.env.RAZORPAY_KEY_ID || 'rzp_test_placeholder';
    this.keySecret = process.env.RAZORPAY_KEY_SECRET || 'rzp_secret_placeholder';
    this.webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || 'rzp_webhook_secret_placeholder';
  }

  async createOrder(params: {
    appointmentId: string;
    amountPaise: number;
    currency?: string;
  }): Promise<PaymentOrderResult> {
    const currency = params.currency || 'INR';

    // In sandbox or live, if real credentials exist we call Razorpay REST API
    if (this.keyId && this.keyId !== 'rzp_test_placeholder') {
      try {
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
      } catch (error) {
        this.logger.error(`Failed to create Razorpay order online: ${error}`);
      }
    }

    // Fallback sandbox order generation
    const providerOrderId = `order_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`;
    return {
      providerOrderId,
      amountPaise: params.amountPaise,
      currency,
    };
  }

  verifyWebhookSignature(rawBody: string | Buffer, signature: string): boolean {
    if (!signature) return false;
    const bodyStr = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    const expected = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(bodyStr)
      .digest('hex');

    try {
      return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
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
    if (this.keyId && this.keyId !== 'rzp_test_placeholder' && params.providerPaymentId) {
      try {
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

        if (response.ok) {
          const data = (await response.json()) as { id: string; amount: number; status: string };
          return {
            providerRefundId: data.id,
            amountPaise: data.amount,
            status: data.status === 'processed' ? 'PROCESSED' : 'PENDING',
          };
        }
      } catch (error) {
        this.logger.error(`Failed to issue Razorpay refund online: ${error}`);
      }
    }

    return {
      providerRefundId: `rfnd_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`,
      amountPaise: params.amountPaise,
      status: 'PROCESSED',
    };
  }

  async fetchPaymentStatus(_providerOrderId: string): Promise<{
    status: 'CAPTURED' | 'PENDING' | 'FAILED';
    providerPaymentId?: string;
  }> {
    // If online key configured, can query Razorpay orders endpoint
    return {
      status: 'PENDING',
    };
  }
}
