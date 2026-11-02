import * as crypto from 'crypto';
import * as path from 'path';
import {
  Injectable,
  Inject,
  ForbiddenException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../platform/database/prisma.service';

export interface PresignedUploadResult {
  uploadUrl: string;
  downloadUrl: string;
  fileKey: string;
  expiresInSeconds: number;
}

@Injectable()
export class AttachmentService {
  private readonly allowedMimes = new Set([
    'application/pdf',
    'image/jpeg',
    'image/png',
  ]);
  private readonly allowedExtensions = new Set(['.pdf', '.jpg', '.jpeg', '.png']);
  private readonly maxSizeBytes = 10 * 1024 * 1024; // 10MB
  private readonly minioEndpoint: string;
  private readonly bucketName: string;
  private readonly signingSecret: string;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {
    this.minioEndpoint = process.env.MINIO_ENDPOINT || 'http://localhost:9000';
    this.bucketName = process.env.MINIO_BUCKET || 'medibook-attachments';
    this.signingSecret = process.env.MINIO_SIGNING_SECRET || 'local_s3_secret_token_12345';
  }

  /**
   * Generates presigned upload URL with strict type and size validation,
   * scoped only to appointment participants.
   */
  async generatePresignedUploadUrl(params: {
    appointmentId: string;
    userId: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
  }): Promise<PresignedUploadResult> {
    const { appointmentId, userId, fileName, mimeType, sizeBytes } = params;

    // 1. Participant check
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: { doctor: true },
    });

    if (!appointment) {
      throw new NotFoundException(`Appointment ${appointmentId} not found`);
    }

    const isPatient = appointment.patientId === userId;
    const isDoctor = appointment.doctor.userId === userId;

    if (!isPatient && !isDoctor) {
      throw new ForbiddenException(
        'Access denied: You are not authorized to upload files for this consultation',
      );
    }

    // 2. MIME type & extension validation
    const ext = path.extname(fileName).toLowerCase();
    if (!this.allowedExtensions.has(ext)) {
      throw new BadRequestException(
        `File extension ${ext} is not allowed. Supported extensions: .pdf, .jpg, .jpeg, .png`,
      );
    }

    if (!this.allowedMimes.has(mimeType)) {
      throw new BadRequestException(
        `MIME type ${mimeType} is not permitted. Only medical PDFs and images are allowed`,
      );
    }

    // 3. File size cap validation
    if (sizeBytes > this.maxSizeBytes) {
      throw new BadRequestException(
        `File size (${(sizeBytes / 1024 / 1024).toFixed(1)}MB) exceeds maximum allowed limit of 10MB`,
      );
    }

    // 4. Scoped storage path: appointments/{appointmentId}/{randomUUID}{ext}
    const safeId = crypto.randomUUID();
    const fileKey = `appointments/${appointmentId}/${safeId}${ext}`;
    const expiresInSeconds = 900; // 15 minutes
    const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;

    // Cryptographic signature token for upload
    const signature = crypto
      .createHmac('sha256', this.signingSecret)
      .update(`${fileKey}:${expiresAt}:${mimeType}`)
      .digest('hex');

    const uploadUrl = `${this.minioEndpoint}/${this.bucketName}/${fileKey}?expires=${expiresAt}&sig=${signature}`;
    const downloadUrl = `${this.minioEndpoint}/${this.bucketName}/${fileKey}`;

    return {
      uploadUrl,
      downloadUrl,
      fileKey,
      expiresInSeconds,
    };
  }

  /**
   * Verifies access and generates presigned download URL for an attachment.
   */
  async verifyAndGetDownloadUrl(
    appointmentId: string,
    userId: string,
    fileKey: string,
  ): Promise<string> {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: { doctor: true },
    });

    if (!appointment) throw new NotFoundException('Appointment not found');

    const isAuthorized =
      appointment.patientId === userId || appointment.doctor.userId === userId;

    if (!isAuthorized) {
      throw new ForbiddenException('Access denied to consultation attachment');
    }

    // Ensure requested fileKey belongs to this appointment
    if (!fileKey.startsWith(`appointments/${appointmentId}/`)) {
      throw new ForbiddenException('Attachment does not belong to this consultation');
    }

    const expiresAt = Math.floor(Date.now() / 1000) + 3600; // 1 hour
    const sig = crypto
      .createHmac('sha256', this.signingSecret)
      .update(`${fileKey}:${expiresAt}:download`)
      .digest('hex');

    return `${this.minioEndpoint}/${this.bucketName}/${fileKey}?expires=${expiresAt}&sig=${sig}`;
  }
}
