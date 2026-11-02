import { Injectable } from '@nestjs/common';
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
  constructor(private readonly prisma: PrismaService) {}

  async log(params: AuditLogParams): Promise<void> {
    try {
      await this.prisma.auditLog.create({
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
  ): Promise<void> {
    await this.log({
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
    });
  }
}
