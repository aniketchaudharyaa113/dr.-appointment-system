import { describe, it, expect, beforeEach } from 'vitest';
import { PaymentService } from '../src/modules/payments/services/payment.service';
import { LedgerService } from '../src/modules/payments/services/ledger.service';
import { FakePaymentProvider } from '../src/modules/payments/providers/fake.provider';

describe('Phase 4: Same Webhook Replayed 10x Concurrently', () => {
  let paymentService: PaymentService;
  let ledgerService: LedgerService;
  let fakeProvider: FakePaymentProvider;

  // In-memory mock storage
  let paymentEvents: any[];
  let payments: any[];
  let appointments: any[];
  let ledgerEntries: any[];
  let outboxEvents: any[];

  beforeEach(() => {
    fakeProvider = new FakePaymentProvider();
    paymentEvents = [];
    payments = [
      {
        id: 'pay-123',
        appointmentId: 'appt-123',
        provider: 'FAKE',
        providerOrderId: 'order_test_10x',
        amountPaise: 100000,
        currency: 'INR',
        status: 'INITIATED',
        idempotencyKey: 'idem-1',
      },
    ];
    appointments = [
      {
        id: 'appt-123',
        patientId: 'pat-1',
        doctorId: 'doc-1',
        slotTime: new Date(Date.now() + 86400000),
        status: 'PENDING_PAYMENT',
        bookingRef: 'MB-20261102-001',
      },
    ];
    ledgerEntries = [];
    outboxEvents = [];

    const mockPrisma: any = {
      payment: {
        findUnique: ({ where }: any) => {
          if (where.providerOrderId) {
            const p = payments.find((x) => x.providerOrderId === where.providerOrderId);
            if (p) {
              const appt = appointments.find((a) => a.id === p.appointmentId);
              return { ...p, appointment: appt };
            }
          }
          return payments.find((x) => x.id === where.id) || null;
        },
        update: ({ where, data }: any) => {
          const p = payments.find((x) => x.id === where.id);
          if (p) Object.assign(p, data);
          return p;
        },
      },
      appointment: {
        findUnique: ({ where }: any) => appointments.find((a) => a.id === where.id) || null,
        update: ({ where, data }: any) => {
          const a = appointments.find((x) => x.id === where.id);
          if (a) Object.assign(a, data);
          return a;
        },
      },
      paymentEvent: {
        create: ({ data }: any) => {
          const exists = paymentEvents.find((e) => e.providerEventId === data.providerEventId);
          if (exists) {
            const err: any = new Error('Unique constraint failed on provider_event_id');
            err.code = 'P2002';
            throw err;
          }
          const created = { ...data, id: `evt-${paymentEvents.length + 1}` };
          paymentEvents.push(created);
          return created;
        },
        update: ({ where, data }: any) => {
          const e = paymentEvents.find((x) => x.providerEventId === where.providerEventId);
          if (e) Object.assign(e, data);
          return e;
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
      outboxEvent: {
        create: ({ data }: any) => {
          outboxEvents.push({ ...data, id: `out-${outboxEvents.length + 1}` });
          return data;
        },
      },
      $transaction: async (cb: any) => {
        return cb(mockPrisma);
      },
    };

    ledgerService = new LedgerService(mockPrisma);
    paymentService = new PaymentService(mockPrisma, fakeProvider, ledgerService);
  });

  it('handles 10 concurrent replays of the same webhook with exactly 1 ledger posting', async () => {
    const rawPayload = JSON.stringify({
      id: 'evt_webhook_replay_10x',
      event: 'payment.captured',
      order_id: 'order_test_10x',
      payment_id: 'pay_capture_999',
      amount: 100000,
    });
    const signature = fakeProvider.generateSignature(rawPayload);

    // Replay the identical webhook 10 times concurrently
    const promises = Array.from({ length: 10 }).map(() =>
      paymentService.processWebhook(rawPayload, signature),
    );

    const results = await Promise.all(promises);

    // Exactly 1 request successfully processes and captures
    const captures = results.filter((r) => r.status === 'CAPTURED');
    expect(captures.length).toBe(1);

    // The other 9 return DUPLICATE_NOOP
    const noops = results.filter((r) => r.status === 'DUPLICATE_NOOP');
    expect(noops.length).toBe(9);

    // Payment must be CAPTURED with providerPaymentId
    expect(payments[0].status).toBe('CAPTURED');
    expect(payments[0].providerPaymentId).toBe('pay_capture_999');

    // Appointment must be CONFIRMED
    expect(appointments[0].status).toBe('CONFIRMED');

    // Exactly 3 ledger entries: 1 DEBIT GATEWAY_CLEARING, 1 CREDIT DOCTOR_RECEIVABLE, 1 CREDIT PLATFORM_REVENUE
    expect(ledgerEntries.length).toBe(3);

    // Verify zero-sum invariant on ledger entries
    const isBalanced = await ledgerService.verifyZeroSum('pay-123');
    expect(isBalanced).toBe(true);

    const totalDebit = ledgerEntries
      .filter((e) => e.entryType === 'DEBIT')
      .reduce((sum, e) => sum + e.amountPaise, 0);
    const totalCredit = ledgerEntries
      .filter((e) => e.entryType === 'CREDIT')
      .reduce((sum, e) => sum + e.amountPaise, 0);

    expect(totalDebit).toBe(100000);
    expect(totalCredit).toBe(100000);
  });
});
