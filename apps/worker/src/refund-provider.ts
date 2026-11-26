import * as crypto from 'crypto';

export interface RefundExecutionParams {
  refundId: string;
  paymentId: string;
  providerPaymentId?: string | null;
  amountPaise: number;
  reason?: string | null;
}

export interface RefundExecutionResult {
  providerRefundId: string;
  status: 'PROCESSED' | 'PENDING';
}

export type RefundExecutor = (
  params: RefundExecutionParams,
) => Promise<RefundExecutionResult>;

/**
 * Executes a refund against the configured payment provider (Razorpay or sandbox FAKE).
 */
export const executeProviderRefund: RefundExecutor = async (params) => {
  const provider = (process.env.PAYMENT_PROVIDER || 'FAKE').toUpperCase();

  if (provider === 'RAZORPAY') {
    const keyId = process.env.RAZORPAY_KEY_ID || '';
    const keySecret = process.env.RAZORPAY_KEY_SECRET || '';
    if (!keyId || !keySecret || !params.providerPaymentId) {
      throw new Error(
        'RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, and providerPaymentId are required for Razorpay refund',
      );
    }

    const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
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
            refundId: params.refundId,
            reason: params.reason || 'Requested by patient or system',
          },
        }),
      },
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Razorpay refund failed (${response.status}): ${errText}`);
    }

    const data = (await response.json()) as {
      id: string;
      status: string;
    };

    return {
      providerRefundId: data.id,
      status: data.status === 'processed' ? 'PROCESSED' : 'PENDING',
    };
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('FAKE payment provider cannot execute refunds in production');
  }

  return {
    providerRefundId: `rfnd_fake_${crypto.createHash('sha256').update(params.refundId).digest('hex').slice(0, 14)}`,
    status: 'PROCESSED',
  };
};
