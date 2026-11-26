import { Injectable, NotFoundException, ConflictException, Inject } from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from '../platform/database/prisma.service';
import { AuditService } from '../platform/audit/audit.service';
import { DoctorVerificationStatus } from '@prisma/client';
import { AdminCreateUserInput } from '@medibook/shared';

@Injectable()
export class AdminService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

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
