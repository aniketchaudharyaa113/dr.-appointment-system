import * as crypto from 'crypto';
import { Injectable } from '@nestjs/common';
import {
  PaymentProvider,
  PaymentOrderResult,
  RefundResult,
  ParsedWebhookEvent,
} from './payment-provider.interface';

@Injectable()
export class FakePaymentProvider implements PaymentProvider {
  readonly name = 'FAKE';
  private readonly webhookSecret = process.env.PAYMENT_WEBHOOK_SECRET || 'fake_webhook_secret_for_testing_123';
  private orders = new Map<string, { amountPaise: number; status: 'CAPTURED' | 'PENDING' | 'FAILED'; providerPaymentId?: string }>();

  // Configurable failure simulation flags
  public simulateFailure = false;
  public simulateDelayedWebhook = false;

  async createOrder(params: {
    appointmentId: string;
    amountPaise: number;
    currency?: string;
  }): Promise<PaymentOrderResult> {
    const providerOrderId = `fake_ord_${crypto.randomUUID().slice(0, 16)}`;
    this.orders.set(providerOrderId, {
      amountPaise: params.amountPaise,
      status: this.simulateFailure ? 'FAILED' : 'PENDING',
    });

    return {
      providerOrderId,
      amountPaise: params.amountPaise,
      currency: params.currency || 'INR',
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

  generateSignature(rawBody: string | Buffer): string {
    const bodyStr = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    return crypto
      .createHmac('sha256', this.webhookSecret)
      .update(bodyStr)
      .digest('hex');
  }

  parseWebhookEvent(rawBody: string | Buffer): ParsedWebhookEvent {
    const bodyStr = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    const json = JSON.parse(bodyStr);

    return {
      eventId: json.id || `evt_${crypto.randomUUID().slice(0, 12)}`,
      eventType: json.event || 'payment.captured',
      providerOrderId: json.payload?.payment?.entity?.order_id || json.order_id || '',
      providerPaymentId: json.payload?.payment?.entity?.id || json.payment_id || `fake_pay_${crypto.randomUUID().slice(0, 12)}`,
      amountPaise: json.payload?.payment?.entity?.amount || json.amount || 0,
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
    if (!existing) {
      return { status: 'FAILED' };
    }
    return {
      status: existing.status,
      providerPaymentId: existing.providerPaymentId,
    };
  }

  // Helper for tests to simulate external capture
  simulateExternalCapture(providerOrderId: string, providerPaymentId = `fake_pay_${Date.now()}`): void {
    const ord = this.orders.get(providerOrderId);
    if (ord) {
      ord.status = 'CAPTURED';
      ord.providerPaymentId = providerPaymentId;
    } else {
      this.orders.set(providerOrderId, {
        amountPaise: 0,
        status: 'CAPTURED',
        providerPaymentId,
      });
    }
  }
}

