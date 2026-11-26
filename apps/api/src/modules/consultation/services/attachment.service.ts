import * as crypto from 'crypto';
import * as path from 'path';
import {
  Injectable,
  Inject,
  ForbiddenException,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PrismaService } from '../../platform/database/prisma.service';
import { env } from '../../../common/config/env.schema';

export interface PresignedUploadResult {
  uploadUrl: string;
  downloadUrl: string;
  fileKey: string;
  expiresInSeconds: number;
}

@Injectable()
export class AttachmentService {
  private readonly logger = new Logger(AttachmentService.name);
  private readonly allowedMimes = new Set([
    'application/pdf',
    'image/jpeg',
    'image/png',
  ]);
  private readonly allowedExtensions = new Set(['.pdf', '.jpg', '.jpeg', '.png']);
  private readonly maxSizeBytes = 10 * 1024 * 1024; // 10MB
  private readonly bucketName: string;
  private readonly s3Client: S3Client;
  private readonly publicS3Client: S3Client;
  private bucketVerified = false;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {
    const protocol = env.MINIO_USE_SSL ? 'https' : 'http';
    const internalEndpoint = env.MINIO_ENDPOINT.startsWith('http')
      ? env.MINIO_ENDPOINT
      : `${protocol}://${env.MINIO_ENDPOINT}:${env.MINIO_PORT}`;

    const publicEndpoint = env.MINIO_PUBLIC_URL || internalEndpoint;

    this.bucketName = env.MINIO_BUCKET;

    const baseConfig = {
      region: 'ap-south-1',
      forcePathStyle: true,
      credentials: {
        accessKeyId: env.MINIO_ACCESS_KEY,
        secretAccessKey: env.MINIO_SECRET_KEY,
      },
    };

    this.s3Client = new S3Client({
      ...baseConfig,
      endpoint: internalEndpoint,
    });

    this.publicS3Client = new S3Client({
      ...baseConfig,
      endpoint: publicEndpoint,
    });
  }

  private async ensureBucketExists() {
    if (this.bucketVerified) return;
    try {
      await this.s3Client.send(new HeadBucketCommand({ Bucket: this.bucketName }));
      this.bucketVerified = true;
    } catch {
      try {
        await this.s3Client.send(
          new CreateBucketCommand({ Bucket: this.bucketName }),
        );
        this.bucketVerified = true;
      } catch (err: any) {
        this.logger.warn(
          `Could not verify/create MinIO bucket ${this.bucketName}: ${err.message}`,
        );
      }
    }
  }

  /**
   * Generates real AWS S3/MinIO presigned PUT upload URL and GET download URL,
   * strictly scoped to appointment participants and validated for MIME/extension/size.
   */
  async generatePresignedUploadUrl(params: {
    appointmentId: string;
    userId: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
  }): Promise<PresignedUploadResult> {
    const { appointmentId, userId, fileName, mimeType, sizeBytes } = params;

    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: { doctor: true, consultation: true },
    });

    if (!appointment) {
      throw new NotFoundException(`Appointment ${appointmentId} not found`);
    }

    if (
      appointment.status !== 'CONFIRMED' &&
      appointment.status !== 'IN_PROGRESS' &&
      appointment.status !== 'COMPLETED'
    ) {
      throw new BadRequestException(
        `Cannot upload attachments for appointment in status ${appointment.status}`,
      );
    }

    const isPatient = appointment.patientId === userId;
    const isDoctor = appointment.doctor.userId === userId;

    if (!isPatient && !isDoctor) {
      throw new ForbiddenException(
        'Access denied: You are not authorized to upload files for this consultation',
      );
    }

    if (appointment.status === 'COMPLETED') {
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      const completedTime =
        appointment.consultation?.endedAt?.getTime() ||
        appointment.updatedAt.getTime();
      if (Date.now() - completedTime > sevenDaysMs) {
        throw new BadRequestException(
          'Follow-up upload window has closed (limited to 7 days post-consultation)',
        );
      }
    }

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

    if (sizeBytes > this.maxSizeBytes) {
      throw new BadRequestException(
        `File size (${(sizeBytes / 1024 / 1024).toFixed(1)}MB) exceeds maximum allowed limit of 10MB`,
      );
    }

    await this.ensureBucketExists();

    const safeId = crypto.randomUUID();
    const fileKey = `appointments/${appointmentId}/${safeId}${ext}`;
    const expiresInSeconds = 900; // 15 minutes

    const putCmd = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: fileKey,
      ContentType: mimeType,
    });

    const getCmd = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: fileKey,
    });

    const uploadUrl = await getSignedUrl(this.publicS3Client, putCmd, {
      expiresIn: expiresInSeconds,
    });
    const downloadUrl = await getSignedUrl(this.publicS3Client, getCmd, {
      expiresIn: 3600,
    });

    return {
      uploadUrl,
      downloadUrl,
      fileKey,
      expiresInSeconds,
    };
  }

  /**
   * Verifies access and generates real presigned S3/MinIO GET download URL.
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

    if (!fileKey.startsWith(`appointments/${appointmentId}/`)) {
      throw new ForbiddenException('Attachment does not belong to this consultation');
    }

    const getCmd = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: fileKey,
    });

    return getSignedUrl(this.publicS3Client, getCmd, { expiresIn: 3600 });
  }
}
