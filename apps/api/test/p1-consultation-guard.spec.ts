import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  bootTestApp,
  resetDatabaseAndRedis,
  seedVerifiedDoctor,
  seedPatient,
  seedAdmin,
  TestContext,
} from './helpers/test-app';
import { ChatService } from '../src/modules/consultation/services/chat.service';
import { AttachmentService } from '../src/modules/consultation/services/attachment.service';
import { ClinicalService } from '../src/modules/consultation/services/clinical.service';
import { ConsultationGateway } from '../src/modules/consultation/gateways/consultation.gateway';
import { BadRequestException } from '@nestjs/common';

describe('P1-3: Consultation Access Guard & Socket Hardening', () => {
  let ctx: TestContext;
  let chatService: ChatService;
  let attachmentService: AttachmentService;
  let clinicalService: ClinicalService;
  let gateway: ConsultationGateway;

  beforeAll(async () => {
    ctx = await bootTestApp();
    await resetDatabaseAndRedis(ctx.prisma, ctx.redisClient);
    chatService = ctx.app.get(ChatService);
    attachmentService = ctx.app.get(AttachmentService);
    clinicalService = ctx.app.get(ClinicalService);
    gateway = ctx.app.get(ConsultationGateway);
  });

  afterAll(async () => {
    if (ctx) await ctx.app.close();
  });

  it('rejects chat, uploads, and vitals on unpaid/cancelled appointments', async () => {
    const { doctor, user: doctorUser } = await seedVerifiedDoctor(ctx.prisma);
    const patientUser = await seedPatient(ctx.prisma);

    const cancelledAppt = await ctx.prisma.appointment.create({
      data: {
        bookingRef: `MB-GC-${Math.random().toString(36).slice(2, 8)}`,
        doctorId: doctor.id,
        patientId: patientUser.id,
        slotTime: new Date(),
        status: 'CANCELLED',
        consultationMode: 'VIDEO',
      },
    });

    const pendingAppt = await ctx.prisma.appointment.create({
      data: {
        bookingRef: `MB-GP-${Math.random().toString(36).slice(2, 8)}`,
        doctorId: doctor.id,
        patientId: patientUser.id,
        slotTime: new Date(),
        status: 'PENDING_PAYMENT',
        consultationMode: 'VIDEO',
      },
    });

    // 1. Chat rejected on CANCELLED and PENDING_PAYMENT
    await expect(
      chatService.sendMessage({
        appointmentId: cancelledAppt.id,
        senderId: patientUser.id,
        content: 'Hello doctor',
      }),
    ).rejects.toThrow(BadRequestException);

    await expect(
      chatService.sendMessage({
        appointmentId: pendingAppt.id,
        senderId: patientUser.id,
        content: 'Hello doctor',
      }),
    ).rejects.toThrow(BadRequestException);

    // 2. Upload URL rejected on CANCELLED and PENDING_PAYMENT
    await expect(
      attachmentService.generatePresignedUploadUrl({
        appointmentId: cancelledAppt.id,
        userId: patientUser.id,
        fileName: 'report.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      }),
    ).rejects.toThrow(BadRequestException);

    await expect(
      attachmentService.generatePresignedUploadUrl({
        appointmentId: pendingAppt.id,
        userId: patientUser.id,
        fileName: 'report.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      }),
    ).rejects.toThrow(BadRequestException);

    // 3. Vitals rejected on CANCELLED and PENDING_PAYMENT
    await expect(
      clinicalService.recordVitals(cancelledAppt.id, patientUser.id, {
        systolicBp: 120,
        diastolicBp: 80,
        heartRate: 72,
      }),
    ).rejects.toThrow(BadRequestException);

    await expect(
      clinicalService.recordVitals(pendingAppt.id, patientUser.id, {
        systolicBp: 120,
        diastolicBp: 80,
        heartRate: 72,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('enforces 7-day follow-up window from consultation.endedAt for COMPLETED appointments', async () => {
    const { doctor, user: doctorUser } = await seedVerifiedDoctor(ctx.prisma);
    const patientUser = await seedPatient(ctx.prisma);

    const completedAppt = await ctx.prisma.appointment.create({
      data: {
        bookingRef: `MB-GC-${Math.random().toString(36).slice(2, 8)}`,
        doctorId: doctor.id,
        patientId: patientUser.id,
        slotTime: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        status: 'COMPLETED',
        consultationMode: 'VIDEO',
      },
    });

    // Case A: consultation ended 8 days ago (> 7 days)
    await ctx.prisma.consultationSession.create({
      data: {
        appointmentId: completedAppt.id,
        roomName: `consult-${completedAppt.id}`,
        status: 'ENDED',
        startedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
        endedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
      },
    });

    await expect(
      chatService.sendMessage({
        appointmentId: completedAppt.id,
        senderId: patientUser.id,
        content: 'Follow-up question after 8 days',
      }),
    ).rejects.toThrow(BadRequestException);

    await expect(
      attachmentService.generatePresignedUploadUrl({
        appointmentId: completedAppt.id,
        userId: patientUser.id,
        fileName: 'report.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      }),
    ).rejects.toThrow(BadRequestException);

    await expect(
      clinicalService.recordVitals(completedAppt.id, patientUser.id, {
        heartRate: 80,
      }),
    ).rejects.toThrow(BadRequestException);

    // Case B: consultation ended 3 days ago (< 7 days) -> chat succeeds!
    await ctx.prisma.consultationSession.update({
      where: { appointmentId: completedAppt.id },
      data: {
        endedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      },
    });

    const msg = await chatService.sendMessage({
      appointmentId: completedAppt.id,
      senderId: patientUser.id,
      content: 'Follow-up question within 7 days',
    });
    expect(msg.id).toBeDefined();
    expect(msg.content).toBe('Follow-up question within 7 days');
  });

  it('denies admin from joining consultation PHI socket room and validates send_message schema', async () => {
    const { doctor, user: doctorUser } = await seedVerifiedDoctor(ctx.prisma);
    const patientUser = await seedPatient(ctx.prisma);
    const adminUser = await seedAdmin(ctx.prisma);

    const appt = await ctx.prisma.appointment.create({
      data: {
        bookingRef: `MB-GS-${Math.random().toString(36).slice(2, 8)}`,
        doctorId: doctor.id,
        patientId: patientUser.id,
        slotTime: new Date(),
        status: 'CONFIRMED',
        consultationMode: 'VIDEO',
      },
    });

    // 1. Admin join_room returns Forbidden error
    const fakeAdminClient: any = {
      user: { sub: adminUser.id, email: adminUser.email, role: 'ADMIN' },
      join: () => Promise.resolve(),
    };
    const adminJoinRes = await gateway.handleJoinRoom(fakeAdminClient, {
      appointmentId: appt.id,
    });
    expect(adminJoinRes).toEqual({
      error: 'Forbidden: Not a participant in this consultation',
    });

    // 2. Doctor join_room succeeds
    const fakeDoctorClient: any = {
      user: { sub: doctorUser.id, email: doctorUser.email, role: 'DOCTOR' },
      join: () => Promise.resolve(),
    };
    const docJoinRes = await gateway.handleJoinRoom(fakeDoctorClient, {
      appointmentId: appt.id,
    });
    expect(docJoinRes).toEqual({
      joined: `consult:${appt.id}`,
    });

    // 3. Socket send_message schema validation: rejects empty content with no attachment
    const fakePatientClient: any = {
      user: { sub: patientUser.id, email: patientUser.email, role: 'PATIENT' },
    };
    const emptyRes = await gateway.handleSendMessage(fakePatientClient, {
      appointmentId: appt.id,
      content: '   ',
    });
    expect(emptyRes.error).toBeDefined();

    // 4. Socket send_message schema validation: rejects content exceeding 4000 characters
    const overLimitRes = await gateway.handleSendMessage(fakePatientClient, {
      appointmentId: appt.id,
      content: 'A'.repeat(4001),
    });
    expect(overLimitRes.error).toBeDefined();

    // 5. Valid socket message succeeds
    gateway.server = {
      to: () => ({ emit: () => true }),
    } as any;

    const validRes = await gateway.handleSendMessage(fakePatientClient, {
      appointmentId: appt.id,
      content: 'Valid message via socket',
    });
    expect(validRes).toHaveProperty('success', true);
    if ('message' in validRes && validRes.message) {
      expect(validRes.message.content).toBe('Valid message via socket');
    }
  });
});
