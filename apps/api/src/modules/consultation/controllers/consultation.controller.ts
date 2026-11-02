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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../identity/guards/jwt-auth.guard';
import { CurrentUser } from '../../identity/decorators/current-user.decorator';
import { LiveKitService } from '../services/livekit.service';
import { ChatService } from '../services/chat.service';
import { AttachmentService } from '../services/attachment.service';
import { PrescriptionService, PrescriptionPayload } from '../services/prescription.service';

@ApiTags('Consultation')
@Controller('consultations')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ConsultationController {
  constructor(
    private readonly livekitService: LiveKitService,
    private readonly chatService: ChatService,
    private readonly attachmentService: AttachmentService,
    private readonly prescriptionService: PrescriptionService,
  ) {}

  @Post(':id/consent')
  @ApiOperation({ summary: 'Record patient telemedicine consent' })
  async recordConsent(@Param('id') appointmentId: string, @CurrentUser() user: any) {
    const success = await this.livekitService.recordConsent(appointmentId, user.userId);
    return { success, message: 'Telemedicine consent recorded successfully' };
  }

  @Post(':id/video-token')
  @ApiOperation({ summary: 'Mint LiveKit video consultation token inside join window' })
  async getVideoToken(@Param('id') appointmentId: string, @CurrentUser() user: any) {
    return this.livekitService.mintJoinToken(appointmentId, user.userId);
  }

  @Post(':id/session-status')
  @ApiOperation({ summary: 'Update consultation session status (WAITING -> LIVE -> ENDED)' })
  async updateStatus(
    @Param('id') appointmentId: string,
    @CurrentUser() user: any,
    @Body() body: { status: 'WAITING' | 'LIVE' | 'ENDED' },
  ) {
    if (!body.status) throw new BadRequestException('status is required');
    return this.livekitService.updateSessionStatus(appointmentId, user.userId, body.status);
  }

  @Get(':id/messages')
  @ApiOperation({ summary: 'Get consultation chat messages history' })
  async getMessages(
    @Param('id') appointmentId: string,
    @CurrentUser() user: any,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    const limitNum = limit ? parseInt(limit, 10) : 50;
    const beforeDate = before ? new Date(before) : undefined;
    return this.chatService.getMessages(appointmentId, user.userId, limitNum, beforeDate);
  }

  @Post(':id/messages')
  @ApiOperation({ summary: 'Send a message in the consultation room' })
  async sendMessage(
    @Param('id') appointmentId: string,
    @CurrentUser() user: any,
    @Body()
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
      senderId: user.userId,
      content: body.content,
      attachmentUrl: body.attachmentUrl,
      attachmentType: body.attachmentType,
    });
  }

  @Post(':id/messages/read')
  @ApiOperation({ summary: 'Mark consultation messages as read' })
  async markRead(@Param('id') appointmentId: string, @CurrentUser() user: any) {
    return this.chatService.markRead(appointmentId, user.userId);
  }

  @Post(':id/attachments/upload-url')
  @ApiOperation({ summary: 'Generate presigned upload URL for medical attachment' })
  async getUploadUrl(
    @Param('id') appointmentId: string,
    @CurrentUser() user: any,
    @Body()
    body: {
      fileName: string;
      mimeType: string;
      sizeBytes: number;
    },
  ) {
    if (!body.fileName || !body.mimeType || !body.sizeBytes) {
      throw new BadRequestException('fileName, mimeType, and sizeBytes are required');
    }
    return this.attachmentService.generatePresignedUploadUrl({
      appointmentId,
      userId: user.userId,
      fileName: body.fileName,
      mimeType: body.mimeType,
      sizeBytes: body.sizeBytes,
    });
  }

  @Post(':id/prescriptions')
  @ApiOperation({ summary: 'Doctor creates prescription for completed appointment' })
  async createPrescription(
    @Param('id') appointmentId: string,
    @CurrentUser() user: any,
    @Body() body: PrescriptionPayload,
  ) {
    return this.prescriptionService.createPrescription(appointmentId, user.userId, body);
  }

  @Put(':id/prescriptions')
  @ApiOperation({ summary: 'Doctor updates prescription, creating a new immutable version' })
  async updatePrescription(
    @Param('id') appointmentId: string,
    @CurrentUser() user: any,
    @Body() body: PrescriptionPayload,
  ) {
    return this.prescriptionService.updatePrescription(appointmentId, user.userId, body);
  }

  @Get(':id/prescriptions')
  @ApiOperation({ summary: 'View prescription and all immutable version history' })
  async getPrescription(@Param('id') appointmentId: string, @CurrentUser() user: any) {
    return this.prescriptionService.getPrescription(appointmentId, user.userId);
  }
}
