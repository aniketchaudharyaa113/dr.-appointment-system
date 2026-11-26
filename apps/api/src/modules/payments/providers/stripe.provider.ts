import * as crypto from 'crypto';
import { Injectable } from '@nestjs/common';
import {
  PaymentProvider,
  PaymentOrderResult,
  RefundResult,
  ParsedWebhookEvent,
} from './payment-provider.interface';
import { env } from '../../../common/config/env.schema';

@Injectable()
export class StripeProvider implements PaymentProvider {
  readonly name = 'STRIPE';

  async createOrder(params: {
    appointmentId: string;
    amountPaise: number;
    currency?: string;
  }): Promise<PaymentOrderResult> {
    const providerOrderId = `pi_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    return {
      providerOrderId,
      amountPaise: params.amountPaise,
      currency: (params.currency || 'INR').toLowerCase(),
    };
  }

  verifyWebhookSignature(rawBody: string | Buffer, signature: string): boolean {
    if (!signature) return false;
    const secret = process.env.STRIPE_WEBHOOK_SECRET || env.PAYMENT_WEBHOOK_SECRET;
    if (!secret) return false;

    const parts = signature.split(',').reduce<Record<string, string>>((acc, item) => {
      const [k, v] = item.split('=');
      if (k && v) acc[k.trim()] = v.trim();
      return acc;
    }, {});

    const timestamp = parts['t'];
    const v1Signature = parts['v1'];
    if (!timestamp || !v1Signature) return false;

    const bodyStr = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    const expectedSig = crypto
      .createHmac('sha256', secret)
      .update(`${timestamp}.${bodyStr}`)
      .digest('hex');

    try {
      const expectedBuf = Buffer.from(expectedSig, 'hex');
      const actualBuf = Buffer.from(v1Signature, 'hex');
      if (expectedBuf.length !== actualBuf.length) return false;
      return crypto.timingSafeEqual(expectedBuf, actualBuf);
    } catch {
      return false;
    }
  }

  parseWebhookEvent(rawBody: string | Buffer, headerEventId?: string): ParsedWebhookEvent {
    const bodyStr = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    const json = JSON.parse(bodyStr);

    const intent = json.data?.object;
    return {
      eventId: headerEventId || json.id || `evt_${crypto.randomUUID().slice(0, 12)}`,
      eventType: json.type || 'payment_intent.succeeded',
      providerOrderId: intent?.id || '',
      providerPaymentId: intent?.charges?.data?.[0]?.id || `ch_${crypto.randomUUID().slice(0, 12)}`,
      amountPaise: intent?.amount || 0,
      currency: (intent?.currency || 'INR').toUpperCase(),
      status: json.type === 'payment_intent.payment_failed' ? 'FAILED' : 'CAPTURED',
      rawPayload: json,
    };
  }

  async issueRefund(params: {
    paymentId: string;
    providerPaymentId?: string;
    amountPaise: number;
    reason?: string;
  }): Promise<RefundResult> {
    return {
      providerRefundId: `re_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
      amountPaise: params.amountPaise,
      status: 'PROCESSED',
    };
  }

  async fetchPaymentStatus(_providerOrderId: string): Promise<{
    status: 'CAPTURED' | 'PENDING' | 'FAILED';
    providerPaymentId?: string;
  }> {
    return {
      status: 'PENDING',
    };
  }
}
