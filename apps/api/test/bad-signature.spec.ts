import { describe, it, expect, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { PaymentService } from '../src/modules/payments/services/payment.service';
import { LedgerService } from '../src/modules/payments/services/ledger.service';
import { FakePaymentProvider } from '../src/modules/payments/providers/fake.provider';

describe('Phase 4: Webhook Signature Verification', () => {
  let paymentService: PaymentService;
  let fakeProvider: FakePaymentProvider;

  beforeEach(() => {
    fakeProvider = new FakePaymentProvider();
    const mockPrisma: any = {
      payment: { findUnique: () => null },
      paymentEvent: { create: () => null },
      $transaction: async (cb: any) => cb(mockPrisma),
    };
    const ledgerService = new LedgerService(mockPrisma);
    paymentService = new PaymentService(mockPrisma, fakeProvider, ledgerService);
  });

  it('rejects webhooks with forged or invalid HMAC signatures with 400', async () => {
    const rawPayload = JSON.stringify({
      id: 'evt_forged_sig',
      event: 'payment.captured',
      order_id: 'ord_123',
    });
    const badSignature = 'deadbeefcafebabe1234567890abcdef1234567890abcdef1234567890abcdef';

    await expect(
      paymentService.processWebhook(rawPayload, badSignature),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects webhooks with empty or missing signature', async () => {
    const rawPayload = JSON.stringify({
      id: 'evt_no_sig',
      event: 'payment.captured',
    });

    await expect(
      paymentService.processWebhook(rawPayload, ''),
    ).rejects.toThrow(BadRequestException);
  });
});
