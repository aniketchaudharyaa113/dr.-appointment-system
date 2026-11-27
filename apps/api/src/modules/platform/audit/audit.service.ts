import { Injectable, Inject } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { logger } from '../../../common/logger/pino-logger.service';

export interface AuditLogParams {
  userId?: string;
  action: string;
  resource: string;
  resourceId?: string;
  details?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AuditService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async log(params: AuditLogParams, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx || this.prisma;
    try {
      await db.auditLog.create({
        data: {
          userId: params.userId,
          action: params.action,
          resource: params.resource,
          resourceId: params.resourceId,
          details: params.details,
          ipAddress: params.ipAddress,
          userAgent: params.userAgent,
        },
      });

      logger.info(
        {
          userId: params.userId,
          action: params.action,
          resource: params.resource,
          resourceId: params.resourceId,
        },
        'Audit log recorded',
      );
    } catch (error) {
      if (tx) throw error;
      logger.error({ err: error, params }, 'Failed to write audit log');
    }
  }

  async logPhiRead(
    accessorId: string,
    patientId: string,
    recordType: 'PRESCRIPTION' | 'CONSULTATION_CHAT' | 'MEDICAL_HISTORY',
    recordId: string,
    ipAddress?: string,
    userAgent?: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    await this.log(
      {
        userId: accessorId,
        action: 'PHI_READ',
        resource: recordType,
        resourceId: recordId,
        details: {
          patientId,
          readTimestamp: new Date().toISOString(),
        },
        ipAddress,
        userAgent,
      },
      tx,
    );
  }
}
