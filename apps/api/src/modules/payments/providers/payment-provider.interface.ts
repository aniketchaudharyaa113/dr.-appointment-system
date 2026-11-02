export interface PaymentOrderResult {
  providerOrderId: string;
  amountPaise: number;
  currency: string;
}

export interface RefundResult {
  providerRefundId: string;
  amountPaise: number;
  status: 'PROCESSED' | 'PENDING' | 'FAILED';
}

export interface ParsedWebhookEvent {
  eventId: string;
  eventType: string;
  providerOrderId: string;
  providerPaymentId?: string;
  amountPaise: number;
  status: 'CAPTURED' | 'FAILED';
  rawPayload: Record<string, any>;
}

export interface PaymentProvider {
  readonly name: string;

  createOrder(params: {
    appointmentId: string;
    amountPaise: number;
    currency?: string;
  }): Promise<PaymentOrderResult>;

  verifyWebhookSignature(rawBody: string | Buffer, signature: string): boolean;

  parseWebhookEvent(rawBody: string | Buffer): ParsedWebhookEvent;

  issueRefund(params: {
    paymentId: string;
    providerPaymentId?: string;
    amountPaise: number;
    reason?: string;
  }): Promise<RefundResult>;

  fetchPaymentStatus(providerOrderId: string): Promise<{
    status: 'CAPTURED' | 'PENDING' | 'FAILED';
    providerPaymentId?: string;
  }>;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
