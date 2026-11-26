import { Injectable, Logger, Inject } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../platform/database/prisma.service';
import { env } from '../../../common/config/env.schema';

export interface LedgerPostingResult {
  transactionId: string;
  totalDebitPaise: number;
  totalCreditPaise: number;
  isBalanced: boolean;
}

@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);
  readonly commissionBps = env.PLATFORM_COMMISSION_BPS;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Post double-entry records for a captured payment.
   * Debit: ESCROW (full amount collected from patient via payment gateway)
   * Credit: DOCTOR_PAYABLE (doctor's net share)
   * Credit: PLATFORM_REVENUE (platform fee)
   */
  async recordPaymentCapture(
    transactionId: string,
    totalAmountPaise: number,
    commissionBps = this.commissionBps,
    tx?: Prisma.TransactionClient,
  ): Promise<LedgerPostingResult> {
    const db = tx || this.prisma;

    const platformFeePaise = Math.round((totalAmountPaise * commissionBps) / 10000);
    const doctorSharePaise = totalAmountPaise - platformFeePaise;

    if (doctorSharePaise + platformFeePaise !== totalAmountPaise) {
      throw new Error(
        `Ledger integrity error: ${doctorSharePaise} + ${platformFeePaise} !== ${totalAmountPaise}`,
      );
    }

    await db.ledgerEntry.createMany({
      data: [
        {
          transactionId,
          accountType: 'ESCROW',
          entryType: 'DEBIT',
          amountPaise: totalAmountPaise,
          description: 'Patient payment captured into escrow clearing',
        },
        {
          transactionId,
          accountType: 'DOCTOR_PAYABLE',
          entryType: 'CREDIT',
          amountPaise: doctorSharePaise,
          description: 'Doctor consultation payout obligation',
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
    if (!isBalanced) {
      throw new Error(`Ledger zero-sum check failed for ${transactionId}`);
    }

    return {
      transactionId,
      totalDebitPaise: totalAmountPaise,
      totalCreditPaise: doctorSharePaise + platformFeePaise,
      isBalanced,
    };
  }

  /**
   * Post double-entry reversal records for a refund.
   * Debit: DOCTOR_PAYABLE (reversing doctor payout)
   * Debit: PLATFORM_REVENUE (reversing platform commission)
   * Credit: ESCROW (cash outflow back to patient)
   */
  async recordRefund(
    transactionId: string,
    refundAmountPaise: number,
    commissionBps = this.commissionBps,
    tx?: Prisma.TransactionClient,
  ): Promise<LedgerPostingResult> {
    const db = tx || this.prisma;

    const platformFeeReversal = Math.round((refundAmountPaise * commissionBps) / 10000);
    const doctorShareReversal = refundAmountPaise - platformFeeReversal;

    await db.ledgerEntry.createMany({
      data: [
        {
          transactionId,
          accountType: 'DOCTOR_PAYABLE',
          entryType: 'DEBIT',
          amountPaise: doctorShareReversal,
          description: 'Reversal of doctor payout obligation due to refund',
        },
        {
          transactionId,
          accountType: 'PLATFORM_REVENUE',
          entryType: 'DEBIT',
          amountPaise: platformFeeReversal,
          description: 'Reversal of platform commission due to refund',
        },
        {
          transactionId,
          accountType: 'ESCROW',
          entryType: 'CREDIT',
          amountPaise: refundAmountPaise,
          description: 'Refund cash outflow from escrow to patient',
        },
      ],
    });

    const isBalanced = await this.verifyZeroSum(transactionId, db);
    if (!isBalanced) {
      throw new Error(`Ledger zero-sum check failed for refund ${transactionId}`);
    }

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
  async verifyZeroSum(transactionId: string, tx?: Prisma.TransactionClient): Promise<boolean> {
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
