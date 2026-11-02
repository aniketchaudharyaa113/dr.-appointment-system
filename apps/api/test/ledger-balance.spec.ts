import { describe, it, expect, beforeEach } from 'vitest';
import { LedgerService } from '../src/modules/payments/services/ledger.service';

describe('Phase 4: Double-Entry Ledger Zero-Sum Invariant', () => {
  let ledgerService: LedgerService;
  let ledgerEntries: any[];

  beforeEach(() => {
    ledgerEntries = [];
    const mockPrisma: any = {
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
    };
    ledgerService = new LedgerService(mockPrisma);
  });

  it('guarantees sum(debit) === sum(credit) for payment captures', async () => {
    const txId = 'tx-capture-test';
    const amountPaise = 250000; // Rs 2500.00

    const result = await ledgerService.recordPaymentCapture(txId, amountPaise, 1500); // 15% platform fee

    expect(result.isBalanced).toBe(true);
    expect(result.totalDebitPaise).toBe(250000);
    expect(result.totalCreditPaise).toBe(250000);

    const isZeroSum = await ledgerService.verifyZeroSum(txId);
    expect(isZeroSum).toBe(true);
  });

  it('guarantees sum(debit) === sum(credit) for partial and full refunds', async () => {
    const txId = 'tx-refund-test';
    const fullAmount = 100000;

    // Capture payment
    await ledgerService.recordPaymentCapture(txId, fullAmount, 1000);

    // Issue 50% partial refund
    const refundResult = await ledgerService.recordRefund(txId, 50000, 1000);

    expect(refundResult.isBalanced).toBe(true);
    expect(refundResult.totalDebitPaise).toBe(50000);
    expect(refundResult.totalCreditPaise).toBe(50000);

    // Both entries combined must still maintain overall balance
    const isOverallBalanced = await ledgerService.verifyZeroSum(txId);
    expect(isOverallBalanced).toBe(true);
  });
});
