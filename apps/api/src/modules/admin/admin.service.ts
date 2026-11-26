import { Injectable, NotFoundException, ConflictException, Inject } from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from '../platform/database/prisma.service';
import { AuditService } from '../platform/audit/audit.service';
import { PaymentService } from '../payments/services/payment.service';
import { DoctorVerificationStatus } from '@prisma/client';
import { AdminCreateUserInput } from '@medibook/shared';

@Injectable()
export class AdminService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PaymentService) private readonly paymentService: PaymentService,
  ) {}

  async getAdminStats() {
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    const [
      pendingDoctorsCount,
      stuckPaymentsCount,
      capturedPayments,
      activeConsultations,
      totalDoctors,
      totalPatients,
    ] = await Promise.all([
      this.prisma.doctor.count({ where: { verificationStatus: 'PENDING' } }),
      this.prisma.payment.count({
        where: { status: 'PENDING', createdAt: { lt: fifteenMinutesAgo } },
      }),
      this.prisma.payment.aggregate({
        where: { status: 'CAPTURED' },
        _sum: { amountPaise: true },
      }),
      this.prisma.consultationSession.count({ where: { status: 'LIVE' } }),
      this.prisma.doctor.count({ where: { isVerified: true } }),
      this.prisma.user.count({ where: { role: 'PATIENT' } }),
    ]);

    return {
      pendingDoctorsCount,
      stuckPaymentsCount,
      totalPlatformRevenuePaise: capturedPayments._sum.amountPaise || 0,
      activeConsultations,
      totalDoctors,
      totalPatients,
    };
  }

  async getLedgerEntries() {
    const entries = await this.prisma.ledgerEntry.findMany({
      include: {
        payment: {
          select: {
            id: true,
            status: true,
            appointment: { select: { id: true, bookingRef: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return entries.map((e) => ({
      id: e.id,
      transactionId: e.transactionId,
      reference: e.payment?.appointment?.bookingRef || e.transactionId.slice(0, 8),
      description: e.description || `${e.accountType} ${e.entryType}`,
      accountType: e.accountType,
      entryType: e.entryType,
      amountPaise: e.amountPaise,
      createdAt: e.createdAt.toISOString(),
    }));
  }

  async getAuditLogs() {
    const logs = await this.prisma.auditLog.findMany({
      include: {
        user: { select: { id: true, name: true, email: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return logs.map((l) => ({
      id: l.id,
      action: l.action,
      resource: `${l.resource}${l.resourceId ? `: ${l.resourceId.slice(0, 8)}` : ''}`,
      actor: l.user ? `${l.user.name} (${l.user.role})` : 'System Worker',
      ip: l.ipAddress || '127.0.0.1',
      details: l.details,
      createdAt: l.createdAt.toISOString(),
    }));
  }

  async reconcilePayments() {
    const count = await this.paymentService.reconcileStuckPayments();
    return { reconciledCount: count };
  }

  async getPendingDoctors() {
    return this.prisma.doctor.findMany({
      where: { verificationStatus: 'PENDING' },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            phone: true,
            createdAt: true,
          },
        },
      },
      orderBy: { user: { createdAt: 'desc' } },
    });
  }

  async verifyDoctor(
    doctorId: string,
    status: DoctorVerificationStatus,
    adminId: string,
    ipAddress?: string,
    userAgent?: string,
    rejectionReason?: string,
  ) {
    const doctor = await this.prisma.doctor.findUnique({
      where: { id: doctorId },
      include: { user: true },
    });

    if (!doctor) {
      throw new NotFoundException('Doctor profile not found');
    }

    const isVerified = status === 'APPROVED';

    const updated = await this.prisma.doctor.update({
      where: { id: doctorId },
      data: {
        verificationStatus: status,
        isVerified,
      },
    });

    await this.audit.log({
      userId: adminId,
      action: `DOCTOR_VERIFICATION_${status}`,
      resource: 'DOCTOR',
      resourceId: doctorId,
      details: {
        doctorEmail: doctor.user.email,
        licenseNumber: doctor.licenseNumber,
        newStatus: status,
        isVerified,
        ...(rejectionReason ? { rejectionReason } : {}),
      },
      ipAddress,
      userAgent,
    });

    return updated;
  }

  async createPrivilegedUser(
    input: AdminCreateUserInput,
    adminId: string,
    ipAddress?: string,
    userAgent?: string,
  ) {
    const email = input.email.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('A user with this email already exists');
    }

    const passwordHash = await argon2.hash(input.password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 1,
    });

    const created = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          passwordHash,
          name: input.name,
          phone: input.phone,
          role: input.role,
        },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          createdAt: true,
        },
      });

      if (input.role === 'DRIVER') {
        await tx.ambulanceDriverProfile.create({
          data: {
            userId: user.id,
            vehicleNumber: input.vehicleNumber || `WB-02-EMS-${Date.now().toString().slice(-4)}`,
            isOnline: false,
          },
        });
      }

      return user;
    });

    await this.audit.log({
      userId: adminId,
      action: `ADMIN_CREATE_${input.role}`,
      resource: 'USER',
      resourceId: created.id,
      details: { email: created.email, role: created.role },
      ipAddress,
      userAgent,
    });

    return created;
  }
}
