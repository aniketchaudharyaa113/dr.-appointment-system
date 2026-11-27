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
    const eventType = String(json.type || '');
    const rawAmount = intent?.amount;
    const amountPaise =
      rawAmount !== undefined && rawAmount !== null ? Number(rawAmount) : undefined;
    const currency = intent?.currency ? String(intent.currency).toUpperCase() : undefined;

    let status: 'CAPTURED' | 'FAILED' | 'IGNORED' = 'IGNORED';
    if (eventType === 'payment_intent.succeeded') {
      status = 'CAPTURED';
    } else if (eventType === 'payment_intent.payment_failed') {
      status = 'FAILED';
    }

    const providerOrderId = intent?.id || '';
    const providerPaymentId = intent?.charges?.data?.[0]?.id;
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
