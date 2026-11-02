import { describe, it, expect, beforeEach } from 'vitest';
import { PaymentService } from '../src/modules/payments/services/payment.service';
import { LedgerService } from '../src/modules/payments/services/ledger.service';
import { FakePaymentProvider } from '../src/modules/payments/providers/fake.provider';

describe('Phase 4: Payment Reconciliation Job', () => {
  let paymentService: PaymentService;
  let ledgerService: LedgerService;
  let fakeProvider: FakePaymentProvider;

  let payments: any[];
  let appointments: any[];
  let ledgerEntries: any[];

  beforeEach(() => {
    fakeProvider = new FakePaymentProvider();
    payments = [
      {
        id: 'pay-stuck-1',
        appointmentId: 'appt-stuck-1',
        provider: 'FAKE',
        providerOrderId: 'ord_stuck_captured',
        amountPaise: 150000,
        currency: 'INR',
        status: 'INITIATED',
        createdAt: new Date(Date.now() - 30 * 60 * 1000), // 30 minutes ago
      },
      {
        id: 'pay-stuck-2',
        appointmentId: 'appt-stuck-2',
        provider: 'FAKE',
        providerOrderId: 'ord_stuck_failed',
        amountPaise: 120000,
        currency: 'INR',
        status: 'INITIATED',
        createdAt: new Date(Date.now() - 25 * 60 * 1000), // 25 minutes ago
      },
    ];
    appointments = [
      {
        id: 'appt-stuck-1',
        status: 'PENDING_PAYMENT',
      },
      {
        id: 'appt-stuck-2',
        status: 'PENDING_PAYMENT',
      },
    ];
    ledgerEntries = [];

    // Simulate provider states: order 1 was actually captured remotely (webhook was lost)
    fakeProvider.simulateExternalCapture('ord_stuck_captured', 'pay_recov_123');

    const mockPrisma: any = {
      payment: {
        findMany: ({ where }: any) => {
          return payments.filter((p) => {
            if (where.status?.in && !where.status.in.includes(p.status)) return false;
            if (where.createdAt?.lt && p.createdAt >= where.createdAt.lt) return false;
            return true;
          });
        },
        update: ({ where, data }: any) => {
          const p = payments.find((x) => x.id === where.id);
          if (p) Object.assign(p, data);
          return p;
        },
      },
      appointment: {
        update: ({ where, data }: any) => {
          const a = appointments.find((x) => x.id === where.id);
          if (a) Object.assign(a, data);
          return a;
        },
      },
      ledgerEntry: {
        createMany: ({ data }: any) => {
          for (const item of data) {
            ledgerEntries.push({ ...item, id: `ledg-${ledgerEntries.length + 1}` });
          }
          return { count: data.length };
        },
        findMany: ({ where }: any) => {
          return ledgerEntries.filter((l) => l.transactionId === where.transactionId);
        },
      },
      $transaction: async (cb: any) => cb(mockPrisma),
    };

    ledgerService = new LedgerService(mockPrisma);
    paymentService = new PaymentService(mockPrisma, fakeProvider, ledgerService);
  });

  it('recovers stuck payments and restores ledger balance', async () => {
    const reconciledCount = await paymentService.reconcileStuckPayments();

    expect(reconciledCount).toBe(2);

    // Stuck order 1 should be CAPTURED and appointment CONFIRMED
    expect(payments[0].status).toBe('CAPTURED');
    expect(payments[0].providerPaymentId).toBe('pay_recov_123');
    expect(appointments[0].status).toBe('CONFIRMED');

    // Stuck order 2 was failed remotely -> marked FAILED
    expect(payments[1].status).toBe('FAILED');

    // Order 1 ledger entries must be posted and balanced
    const balanced = await ledgerService.verifyZeroSum('pay-stuck-1');
    expect(balanced).toBe(true);
    expect(ledgerEntries.length).toBe(3);
  });
});
