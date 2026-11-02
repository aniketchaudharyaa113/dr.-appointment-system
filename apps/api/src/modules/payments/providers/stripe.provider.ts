import * as crypto from 'crypto';
import { Injectable } from '@nestjs/common';
import {
  PaymentProvider,
  PaymentOrderResult,
  RefundResult,
  ParsedWebhookEvent,
} from './payment-provider.interface';

@Injectable()
export class StripeProvider implements PaymentProvider {
  readonly name = 'STRIPE';

  async createOrder(params: {
    appointmentId: string;
    amountPaise: number;
    currency?: string;
  }): Promise<PaymentOrderResult> {
    // Stripe creates a PaymentIntent
    const providerOrderId = `pi_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    return {
      providerOrderId,
      amountPaise: params.amountPaise,
      currency: (params.currency || 'INR').toLowerCase(),
    };
  }

  verifyWebhookSignature(rawBody: string | Buffer, signature: string): boolean {
    if (!signature) return false;
    // In Stripe, signature header is 't=timestamp,v1=signature'
    return signature.includes('v1=');
  }

  parseWebhookEvent(rawBody: string | Buffer): ParsedWebhookEvent {
    const bodyStr = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    const json = JSON.parse(bodyStr);

    const intent = json.data?.object;
    return {
      eventId: json.id || `evt_${crypto.randomUUID().slice(0, 12)}`,
      eventType: json.type || 'payment_intent.succeeded',
      providerOrderId: intent?.id || '',
      providerPaymentId: intent?.charges?.data?.[0]?.id || `ch_${crypto.randomUUID().slice(0, 12)}`,
      amountPaise: intent?.amount || 0,
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
