import { Module } from '@nestjs/common';
import { PlatformModule } from '../platform/platform.module';
import { LiveKitService } from './services/livekit.service';
import { ChatService } from './services/chat.service';
import { AttachmentService } from './services/attachment.service';
import { PrescriptionService } from './services/prescription.service';
import { ConsultationGateway } from './gateways/consultation.gateway';
import { ConsultationController } from './controllers/consultation.controller';

@Module({
  imports: [PlatformModule],
  controllers: [ConsultationController],
  providers: [
    LiveKitService,
    ChatService,
    AttachmentService,
    PrescriptionService,
    ConsultationGateway,
  ],
  exports: [LiveKitService, ChatService, PrescriptionService],
})
export class ConsultationModule {}
