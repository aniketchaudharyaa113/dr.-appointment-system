import { Injectable, BadRequestException, Inject } from '@nestjs/common';
import { PrismaService } from '../../platform/database/prisma.service';
import { AuditService } from '../../platform/audit/audit.service';
import { getIstDayBoundsUtc } from '../../../common/utils/ist-time';

@Injectable()
export class LeaveService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /**
   * Dry-run preview of existing bookings that would be impacted by a planned leave (Asia/Kolkata bounds)
   */
  async previewLeaveImpact(
    doctorId: string,
    startDateStr: string,
    endDateStr: string,
  ) {
    const { start: startDate } = getIstDayBoundsUtc(startDateStr);
    const { end: endDate } = getIstDayBoundsUtc(endDateStr);

    if (startDate > endDate) {
      throw new BadRequestException('startDate cannot be after endDate');
    }

    const affectedAppointments = await this.prisma.appointment.findMany({
      where: {
        doctorId,
        slotTime: { gte: startDate, lte: endDate },
        status: { in: ['PENDING_PAYMENT', 'CONFIRMED'] },
      },
      include: {
        patient: { select: { id: true, name: true, email: true, phone: true } },
      },
      orderBy: { slotTime: 'asc' },
    });

    return {
      affectedCount: affectedAppointments.length,
      appointments: affectedAppointments.map((a) => ({
        id: a.id,
        bookingRef: a.bookingRef,
        slotTime: a.slotTime.toISOString(),
        status: a.status,
        patientName: a.patient.name,
        patientEmail: a.patient.email,
      })),
    };
  }

  /**
   * Applies planned doctor leave and cascades cancellations with automated refund outbox events
   */
  async applyLeave(
    doctorId: string,
    startDateStr: string,
    endDateStr: string,
    reason = 'Doctor planned leave',
    actorUserId?: string,
  ) {
    const { start: startDate } = getIstDayBoundsUtc(startDateStr);
    const { end: endDate } = getIstDayBoundsUtc(endDateStr);

    if (startDate > endDate) {
      throw new BadRequestException('startDate cannot be after endDate');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const leave = await tx.doctorLeave.create({
        data: {
          doctorId,
          startDate: new Date(`${startDateStr}T00:00:00.000Z`),
          endDate: new Date(`${endDateStr}T00:00:00.000Z`),
          reason,
        },
      });

      const activeAppointments = await tx.appointment.findMany({
        where: {
          doctorId,
          slotTime: { gte: startDate, lte: endDate },
          status: { in: ['PENDING_PAYMENT', 'CONFIRMED'] },
        },
      });

      for (const appt of activeAppointments) {
        await tx.appointment.update({
          where: { id: appt.id },
          data: {
            status: 'CANCELLED',
            cancellationReason: `Doctor on leave: ${reason}`,
          },
        });

        await tx.outboxEvent.create({
          data: {
            aggregateType: 'APPOINTMENT',
            aggregateId: appt.id,
            eventType: 'AppointmentCancelledByDoctor',
            payload: {
              appointmentId: appt.id,
              doctorId,
              patientId: appt.patientId,
              slotTime: appt.slotTime.toISOString(),
              reason,
              refundPercent: 100,
            },
          },
        });
      }

      return { leave, cancelledCount: activeAppointments.length };
    });

    await this.audit.log({
      userId: actorUserId,
      action: 'DOCTOR_LEAVE_APPLIED',
      resource: 'DOCTOR_LEAVE',
      resourceId: result.leave.id,
      details: {
        doctorId,
        startDate: startDateStr,
        endDate: endDateStr,
        cancelledCount: result.cancelledCount,
      },
    });

    return result;
  }
}
