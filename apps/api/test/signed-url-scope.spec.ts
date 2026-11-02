import { describe, it, expect, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { AttachmentService } from '../src/modules/consultation/services/attachment.service';

describe('Phase 5: MinIO Attachment Scope and File Validation', () => {
  let attachmentService: AttachmentService;

  const appointmentId = 'appt-attach-1';
  const patientId = 'patient-uuid-1';
  const doctorUserId = 'doctor-uuid-1';

  beforeEach(() => {
    const mockPrisma: any = {
      appointment: {
        findUnique: () => ({
          id: appointmentId,
          patientId,
          doctor: { userId: doctorUserId },
        }),
      },
    };

    attachmentService = new AttachmentService(mockPrisma);
  });

  it('rejects disallowed file extensions like .exe or .sh', async () => {
    await expect(
      attachmentService.generatePresignedUploadUrl({
        appointmentId,
        userId: patientId,
        fileName: 'malware.exe',
        mimeType: 'application/x-msdownload',
        sizeBytes: 1024,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects attachments exceeding the 10MB file size limit', async () => {
    const elevenMb = 11 * 1024 * 1024;

    await expect(
      attachmentService.generatePresignedUploadUrl({
        appointmentId,
        userId: patientId,
        fileName: 'huge_scan.pdf',
        mimeType: 'application/pdf',
        sizeBytes: elevenMb,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('generates presigned upload URL scoped to the appointment directory for valid PDF', async () => {
    const result = await attachmentService.generatePresignedUploadUrl({
      appointmentId,
      userId: patientId,
      fileName: 'blood_test_report.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 500 * 1024, // 500KB
    });

    expect(result.uploadUrl).toBeDefined();
    expect(result.fileKey.startsWith(`appointments/${appointmentId}/`)).toBe(true);
    expect(result.fileKey.endsWith('.pdf')).toBe(true);
    expect(result.expiresInSeconds).toBe(900);
  });
});
