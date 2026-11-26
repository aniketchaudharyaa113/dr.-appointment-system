import { Module } from '@nestjs/common';
import { PlatformModule } from '../platform/platform.module';
import { LiveKitService } from './services/livekit.service';
import { ChatService } from './services/chat.service';
import { AttachmentService } from './services/attachment.service';
import { PrescriptionService } from './services/prescription.service';
import { ClinicalService } from './services/clinical.service';
import { ConsultationGateway } from './gateways/consultation.gateway';
import { ConsultationController } from './controllers/consultation.controller';
import { PatientClinicalController } from './controllers/patient-clinical.controller';

@Module({
  imports: [PlatformModule],
  controllers: [ConsultationController, PatientClinicalController],
  providers: [
    LiveKitService,
    ChatService,
    AttachmentService,
    PrescriptionService,
    ClinicalService,
    ConsultationGateway,
  ],
  exports: [LiveKitService, ChatService, PrescriptionService, ClinicalService],
})
export class ConsultationModule {}
