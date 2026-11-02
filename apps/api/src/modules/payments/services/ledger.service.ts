import { Injectable, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../../platform/database/prisma.service';

export interface LedgerPostingResult {
  transactionId: string;
  totalDebitPaise: number;
  totalCreditPaise: number;
  isBalanced: boolean;
}

@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);
  // Default platform commission: 10% (1000 basis points)
  private readonly commissionBps = 1000;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Post double-entry records for a captured payment.
   * Debit: GATEWAY_CLEARING (full amount)
   * Credit: DOCTOR_RECEIVABLE (doctor's net share)
   * Credit: PLATFORM_REVENUE (platform fee)
   */
  async recordPaymentCapture(
    transactionId: string,
    totalAmountPaise: number,
    commissionBps = this.commissionBps,
    tx?: any,
  ): Promise<LedgerPostingResult> {
    const db = tx || this.prisma;

    const platformFeePaise = Math.round((totalAmountPaise * commissionBps) / 10000);
    const doctorSharePaise = totalAmountPaise - platformFeePaise;

    // Invariant check: doctorShare + platformFee === totalAmountPaise
    if (doctorSharePaise + platformFeePaise !== totalAmountPaise) {
      throw new Error(
        `Ledger integrity error: ${doctorSharePaise} + ${platformFeePaise} !== ${totalAmountPaise}`,
      );
    }

    await db.ledgerEntry.createMany({
      data: [
        {
          transactionId,
          accountType: 'GATEWAY_CLEARING',
          entryType: 'DEBIT',
          amountPaise: totalAmountPaise,
          description: `Patient payment received via gateway clearing`,
        },
        {
          transactionId,
          accountType: 'DOCTOR_RECEIVABLE',
          entryType: 'CREDIT',
          amountPaise: doctorSharePaise,
          description: `Doctor consultation payout obligation`,
        },
        {
          transactionId,
          accountType: 'PLATFORM_REVENUE',
          entryType: 'CREDIT',
          amountPaise: platformFeePaise,
          description: `MediBook platform service commission (${commissionBps / 100}%)`,
        },
      ],
    });

    const isBalanced = await this.verifyZeroSum(transactionId, db);
    return {
      transactionId,
      totalDebitPaise: totalAmountPaise,
      totalCreditPaise: doctorSharePaise + platformFeePaise,
      isBalanced,
    };
  }

  /**
   * Post double-entry reversal records for a refund.
   * Debit: DOCTOR_RECEIVABLE (reversing doctor payout)
   * Debit: PLATFORM_REVENUE (reversing platform commission)
   * Credit: GATEWAY_CLEARING (cash outflow)
   */
  async recordRefund(
    transactionId: string,
    refundAmountPaise: number,
    commissionBps = this.commissionBps,
    tx?: any,
  ): Promise<LedgerPostingResult> {
    const db = tx || this.prisma;

    const platformFeeReversal = Math.round((refundAmountPaise * commissionBps) / 10000);
    const doctorShareReversal = refundAmountPaise - platformFeeReversal;

    await db.ledgerEntry.createMany({
      data: [
        {
          transactionId,
          accountType: 'DOCTOR_RECEIVABLE',
          entryType: 'DEBIT',
          amountPaise: doctorShareReversal,
          description: `Reversal of doctor payout obligation due to refund`,
        },
        {
          transactionId,
          accountType: 'PLATFORM_REVENUE',
          entryType: 'DEBIT',
          amountPaise: platformFeeReversal,
          description: `Reversal of platform commission due to refund`,
        },
        {
          transactionId,
          accountType: 'GATEWAY_CLEARING',
          entryType: 'CREDIT',
          amountPaise: refundAmountPaise,
          description: `Refund cash outflow to patient`,
        },
      ],
    });

    const isBalanced = await this.verifyZeroSum(transactionId, db);
    return {
      transactionId,
      totalDebitPaise: doctorShareReversal + platformFeeReversal,
      totalCreditPaise: refundAmountPaise,
      isBalanced,
    };
  }

  /**
   * Strict invariant check: Sum(DEBIT) === Sum(CREDIT) for the transaction.
   */
  async verifyZeroSum(transactionId: string, tx?: any): Promise<boolean> {
    const db = tx || this.prisma;
    const entries = await db.ledgerEntry.findMany({
      where: { transactionId },
    });

    let totalDebit = 0;
    let totalCredit = 0;

    for (const entry of entries) {
      if (entry.entryType === 'DEBIT') {
        totalDebit += entry.amountPaise;
      } else if (entry.entryType === 'CREDIT') {
        totalCredit += entry.amountPaise;
      }
    }

    const balanced = totalDebit === totalCredit;
    if (!balanced) {
      this.logger.error(
        `LEDGER IMBALANCE DETECTED for transaction ${transactionId}! Total Debit: ${totalDebit}, Total Credit: ${totalCredit}`,
      );
    }

    return balanced;
  }
}
