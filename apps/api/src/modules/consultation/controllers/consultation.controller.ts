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
  ) { }

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
    return this.chatService.sendMessage({
      appointmentId,
      senderId: user.sub,
      content: body.content,
      attachmentUrl: body.attachmentUrl,
      attachmentType: body.attachmentType,
    });
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
}
