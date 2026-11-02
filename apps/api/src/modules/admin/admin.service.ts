import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { PrismaService } from '../platform/database/prisma.service';
import { AuditService } from '../platform/audit/audit.service';
import { DoctorVerificationStatus } from '@prisma/client';

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
}
