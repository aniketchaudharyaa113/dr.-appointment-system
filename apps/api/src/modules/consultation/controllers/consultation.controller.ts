import {
  Controller,
  Post,
  Get,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { z } from 'zod';
import { JwtAuthGuard } from '../../identity/guards/jwt-auth.guard';
import { CurrentUser } from '../../identity/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import {
  JwtPayload,
  UuidSchema,
  ConsultationStatusSchema,
  SendChatMessageSchema,
  UploadAttachmentUrlSchema,
  CreatePrescriptionSchema,
  CreatePrescriptionInput,
} from '@medibook/shared';
import { LiveKitService } from '../services/livekit.service';
import { ChatService } from '../services/chat.service';
import { AttachmentService } from '../services/attachment.service';
import { PrescriptionService } from '../services/prescription.service';
import { ClinicalService } from '../services/clinical.service';
import { ConsultationGateway } from '../gateways/consultation.gateway';

const MessagesQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
  before: z.string().datetime({ offset: true }).optional(),
});

@ApiTags('Consultation')
@Controller('consultations')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ConsultationController {
  constructor(
    @Inject(LiveKitService) private readonly livekitService: LiveKitService,
    @Inject(ChatService) private readonly chatService: ChatService,
    @Inject(AttachmentService) private readonly attachmentService: AttachmentService,
    @Inject(PrescriptionService) private readonly prescriptionService: PrescriptionService,
    @Inject(ClinicalService) private readonly clinicalService: ClinicalService,
    @Inject(ConsultationGateway) private readonly consultationGateway: ConsultationGateway,
  ) {}

  @Post(':id/consent')
  @ApiOperation({ summary: 'Record patient telemedicine consent' })
  async recordConsent(
    @Param('id', new ZodValidationPipe(UuidSchema)) appointmentId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const success = await this.livekitService.recordConsent(appointmentId, user.sub);
    return { success, message: 'Telemedicine consent recorded successfully' };
  }

  @Post(':id/video-token')
  @ApiOperation({ summary: 'Mint LiveKit video consultation token inside join window' })
  async getVideoToken(
    @Param('id', new ZodValidationPipe(UuidSchema)) appointmentId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.livekitService.mintJoinToken(appointmentId, user.sub);
  }

  @Post(':id/session-status')
  @ApiOperation({ summary: 'Update consultation session status (WAITING -> LIVE -> ENDED)' })
  async updateStatus(
    @Param('id', new ZodValidationPipe(UuidSchema)) appointmentId: string,
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(ConsultationStatusSchema))
    body: { status: 'WAITING' | 'LIVE' | 'ENDED' },
  ) {
    return this.livekitService.updateSessionStatus(appointmentId, user.sub, body.status);
  }

  @Get(':id/messages')
  @ApiOperation({ summary: 'Get consultation chat messages history' })
  async getMessages(
    @Param('id', new ZodValidationPipe(UuidSchema)) appointmentId: string,
    @CurrentUser() user: JwtPayload,
    @Query(new ZodValidationPipe(MessagesQuerySchema))
    query: { limit: number; before?: string },
  ) {
    const beforeDate = query.before ? new Date(query.before) : undefined;
    return this.chatService.getMessages(appointmentId, user.sub, query.limit, beforeDate);
  }

  @Post(':id/messages')
  @ApiOperation({ summary: 'Send a message in the consultation room' })
  async sendMessage(
    @Param('id', new ZodValidationPipe(UuidSchema)) appointmentId: string,
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(SendChatMessageSchema))
    body: {
      content: string;
      attachmentUrl?: string;
      attachmentType?: string;
    },
  ) {
    if (!body.content && !body.attachmentUrl) {
      throw new BadRequestException('Content or attachmentUrl is required');
    }
    const message = await this.chatService.sendMessage({
      appointmentId,
      senderId: user.sub,
      content: body.content,
      attachmentUrl: body.attachmentUrl,
      attachmentType: body.attachmentType,
    });
    this.consultationGateway.server
      ?.to(`consult:${appointmentId}`)
      .emit('new_message', message);
    return message;
  }

  @Post(':id/messages/read')
  @ApiOperation({ summary: 'Mark consultation messages as read' })
  async markRead(
    @Param('id', new ZodValidationPipe(UuidSchema)) appointmentId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.chatService.markRead(appointmentId, user.sub);
  }

  @Post(':id/attachments/upload-url')
  @ApiOperation({ summary: 'Generate presigned upload URL for medical attachment' })
  async getUploadUrl(
    @Param('id', new ZodValidationPipe(UuidSchema)) appointmentId: string,
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(UploadAttachmentUrlSchema))
    body: {
      fileName: string;
      mimeType: string;
      sizeBytes: number;
    },
  ) {
    return this.attachmentService.generatePresignedUploadUrl({
      appointmentId,
      userId: user.sub,
      fileName: body.fileName,
      mimeType: body.mimeType,
      sizeBytes: body.sizeBytes,
    });
  }

  @Get(':id/attachments/download-url')
  @ApiOperation({ summary: 'Generate presigned MinIO download URL for consultation attachment' })
  async getDownloadUrl(
    @Param('id', new ZodValidationPipe(UuidSchema)) appointmentId: string,
    @CurrentUser() user: JwtPayload,
    @Query(new ZodValidationPipe(z.object({ fileKey: z.string().min(5).max(500) })))
    query: { fileKey: string },
  ) {
    const downloadUrl = await this.attachmentService.verifyAndGetDownloadUrl(
      appointmentId,
      user.sub,
      query.fileKey,
    );
    return { downloadUrl };
  }

  @Post(':id/attachments/verify')
  @ApiOperation({ summary: 'Verify uploaded attachment with HeadObject and magic bytes scan' })
  async verifyAttachment(
    @Param('id', new ZodValidationPipe(UuidSchema)) appointmentId: string,
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(z.object({ fileKey: z.string().min(5).max(500) })))
    body: { fileKey: string },
  ) {
    return this.attachmentService.verifyUploadedAttachment({
      appointmentId,
      userId: user.sub,
      fileKey: body.fileKey,
    });
  }

  @Post(':id/prescriptions')
  @ApiOperation({ summary: 'Doctor creates prescription for completed appointment' })
  async createPrescription(
    @Param('id', new ZodValidationPipe(UuidSchema)) appointmentId: string,
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(CreatePrescriptionSchema)) body: CreatePrescriptionInput,
  ) {
    return this.prescriptionService.createPrescription(appointmentId, user.sub, body);
  }

  @Put(':id/prescriptions')
  @ApiOperation({ summary: 'Doctor updates prescription, creating a new immutable version' })
  async updatePrescription(
    @Param('id', new ZodValidationPipe(UuidSchema)) appointmentId: string,
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(CreatePrescriptionSchema)) body: CreatePrescriptionInput,
  ) {
    return this.prescriptionService.updatePrescription(appointmentId, user.sub, body);
  }

  @Get(':id/prescriptions')
  @ApiOperation({ summary: 'View prescription and all immutable version history' })
  async getPrescription(
    @Param('id', new ZodValidationPipe(UuidSchema)) appointmentId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.prescriptionService.getPrescription(appointmentId, user.sub);
  }

  @Post(':id/vitals')
  @ApiOperation({ summary: 'Record clinical vital signs for an appointment' })
  async recordVitals(
    @Param('id', new ZodValidationPipe(UuidSchema)) appointmentId: string,
    @CurrentUser() user: JwtPayload,
    @Body(
      new ZodValidationPipe(
        z.object({
          systolicBp: z.number().int().min(50).max(250).optional(),
          diastolicBp: z.number().int().min(30).max(180).optional(),
          heartRate: z.number().int().min(30).max(250).optional(),
          spO2: z.number().min(50).max(100).optional(),
          temperatureF: z.number().min(90).max(110).optional(),
          weightKg: z.number().min(1).max(350).optional(),
          bloodGlucose: z.number().min(20).max(800).optional(),
        }),
      ),
    )
    body: any,
  ) {
    return this.clinicalService.recordVitals(appointmentId, user.sub, body);
  }

  @Get(':id/vitals')
  @ApiOperation({ summary: 'Get vital signs recorded for an appointment' })
  async getVitals(
    @Param('id', new ZodValidationPipe(UuidSchema)) appointmentId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.clinicalService.getVitals(appointmentId, user.sub);
  }

  @Post(':id/lab-orders')
  @ApiOperation({ summary: 'Doctor orders diagnostic laboratory test' })
  async createLabOrder(
    @Param('id', new ZodValidationPipe(UuidSchema)) appointmentId: string,
    @CurrentUser() user: JwtPayload,
    @Body(
      new ZodValidationPipe(
        z.object({
          testName: z.string().min(2).max(120),
          testCode: z.string().min(2).max(30),
          urgency: z.enum(['ROUTINE', 'URGENT', 'STAT']).optional(),
          instructions: z.string().max(500).optional(),
        }),
      ),
    )
    body: any,
  ) {
    return this.clinicalService.createLabOrder(appointmentId, user.sub, body);
  }

  @Get(':id/lab-orders')
  @ApiOperation({ summary: 'Get diagnostic lab orders for an appointment' })
  async getLabOrders(
    @Param('id', new ZodValidationPipe(UuidSchema)) appointmentId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.clinicalService.getLabOrders(appointmentId, user.sub);
  }
}
