import { describe, it, expect, beforeEach } from 'vitest';
import { PaymentService } from '../src/modules/payments/services/payment.service';
import { LedgerService } from '../src/modules/payments/services/ledger.service';
import { FakePaymentProvider } from '../src/modules/payments/providers/fake.provider';

describe('Phase 4: Out-of-Order Webhook Events', () => {
  let paymentService: PaymentService;
  let fakeProvider: FakePaymentProvider;

  let payments: any[];
  let appointments: any[];
  let paymentEvents: any[];
  let ledgerEntries: any[];

  beforeEach(() => {
    fakeProvider = new FakePaymentProvider();
    payments = [
      {
        id: 'pay-ooo-1',
        appointmentId: 'appt-ooo-1',
        provider: 'FAKE',
        providerOrderId: 'ord_ooo_1',
        amountPaise: 50000,
        currency: 'INR',
        status: 'CAPTURED', // Already captured!
        providerPaymentId: 'pay_first_1',
      },
    ];
    appointments = [
      {
        id: 'appt-ooo-1',
        status: 'CONFIRMED',
      },
    ];
    paymentEvents = [];
    ledgerEntries = [];

    const mockPrisma: any = {
      payment: {
        findUnique: ({ where }: any) => {
          const p = payments.find((x) => x.providerOrderId === where.providerOrderId);
          if (p) {
            const appt = appointments.find((a) => a.id === p.appointmentId);
            return { ...p, appointment: appt };
          }
          return null;
        },
        update: ({ where, data }: any) => {
          const p = payments.find((x) => x.id === where.id);
          if (p) Object.assign(p, data);
          return p;
        },
      },
      paymentEvent: {
        create: ({ data }: any) => {
          paymentEvents.push(data);
          return data;
        },
        update: ({ data }: any) => data,
      },
      ledgerEntry: {
        createMany: ({ data }: any) => {
          ledgerEntries.push(...data);
          return { count: data.length };
        },
        findMany: () => ledgerEntries,
      },
      $transaction: async (cb: any) => cb(mockPrisma),
    };

    const ledgerService = new LedgerService(mockPrisma);
    paymentService = new PaymentService(mockPrisma, fakeProvider, ledgerService);
  });

  it('ignores delayed failed event after payment was already captured', async () => {
    const rawPayload = JSON.stringify({
      id: 'evt_delayed_fail',
      event: 'payment.failed',
      order_id: 'ord_ooo_1',
    });
    const signature = fakeProvider.generateSignature(rawPayload);

    const result = await paymentService.processWebhook(rawPayload, signature);

    expect(result.status).toBe('ALREADY_CAPTURED');
    expect(payments[0].status).toBe('CAPTURED');
    expect(appointments[0].status).toBe('CONFIRMED');
    expect(ledgerEntries.length).toBe(0); // No double posting
  });
});
