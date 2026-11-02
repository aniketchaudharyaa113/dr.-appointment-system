import { describe, it, expect, beforeEach } from 'vitest';
import { PaymentService } from '../src/modules/payments/services/payment.service';
import { LedgerService } from '../src/modules/payments/services/ledger.service';
import { FakePaymentProvider } from '../src/modules/payments/providers/fake.provider';

describe('Phase 4: Late Payment Auto-Refund Protection', () => {
  let paymentService: PaymentService;
  let fakeProvider: FakePaymentProvider;

  let payments: any[];
  let appointments: any[];
  let refunds: any[];
  let outboxEvents: any[];

  beforeEach(() => {
    fakeProvider = new FakePaymentProvider();
    payments = [
      {
        id: 'pay-late-1',
        appointmentId: 'appt-cancelled-1',
        provider: 'FAKE',
        providerOrderId: 'order_late_slot_lost',
        amountPaise: 80000,
        currency: 'INR',
        status: 'INITIATED',
        idempotencyKey: 'idem-late',
      },
    ];
    appointments = [
      {
        id: 'appt-cancelled-1',
        patientId: 'pat-1',
        doctorId: 'doc-1',
        slotTime: new Date(Date.now() + 86400000),
        status: 'CANCELLED', // Hold expired and slot was released/cancelled!
      },
    ];
    refunds = [];
    outboxEvents = [];

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
      appointment: {
        update: ({ where, data }: any) => {
          const a = appointments.find((x) => x.id === where.id);
          if (a) Object.assign(a, data);
          return a;
        },
      },
      paymentEvent: {
        create: ({ data }: any) => data,
        update: ({ data }: any) => data,
      },
      refund: {
        create: ({ data }: any) => {
          const r = { ...data, id: `rfnd-${refunds.length + 1}` };
          refunds.push(r);
          return r;
        },
      },
      outboxEvent: {
        create: ({ data }: any) => {
          outboxEvents.push(data);
          return data;
        },
      },
      ledgerEntry: {
        createMany: () => ({ count: 0 }),
        findMany: () => [],
      },
      $transaction: async (cb: any) => cb(mockPrisma),
    };

    const ledgerService = new LedgerService(mockPrisma);
    paymentService = new PaymentService(mockPrisma, fakeProvider, ledgerService);
  });

  it('triggers automated refund when payment arrives for an expired/cancelled slot', async () => {
    const rawPayload = JSON.stringify({
      id: 'evt_late_payment',
      event: 'payment.captured',
      order_id: 'order_late_slot_lost',
      payment_id: 'pay_late_capture_123',
      amount: 80000,
    });
    const signature = fakeProvider.generateSignature(rawPayload);

    const result = (await paymentService.processWebhook(rawPayload, signature)) as any;

    expect(result.status).toBe('AUTO_REFUNDED');
    expect(result.reason).toBe('SLOT_EXPIRED_OR_LOST');

    // Payment marked as REFUNDED, not CAPTURED
    expect(payments[0].status).toBe('REFUNDED');

    // Appointment remains CANCELLED (never illegally confirmed)
    expect(appointments[0].status).toBe('CANCELLED');

    // Refund record created
    expect(refunds.length).toBe(1);
    expect(refunds[0].amountPaise).toBe(80000);
    expect(refunds[0].reason).toBe('AUTO_REFUND_LATE_PAYMENT');

    // Outbox notification published for patient
    expect(outboxEvents.some((e) => e.eventType === 'PAYMENT_AUTO_REFUNDED')).toBe(true);
  });
});
