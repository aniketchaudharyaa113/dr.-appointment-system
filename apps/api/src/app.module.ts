import { Module } from '@nestjs/common';
import { PlatformModule } from './modules/platform/platform.module';
import { IdentityModule } from './modules/identity/identity.module';
import { AdminModule } from './modules/admin/admin.module';
import { SchedulingModule } from './modules/scheduling/scheduling.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { ConsultationModule } from './modules/consultation/consultation.module';
import { AmbulanceModule } from './modules/ambulance/ambulance.module';
import { AiGatewayModule } from './modules/ai-gateway/ai-gateway.module';

@Module({
  imports: [
    PlatformModule,
    IdentityModule,
    AdminModule,
    SchedulingModule,
    PaymentsModule,
    ConsultationModule,
    AmbulanceModule,
    AiGatewayModule,
  ],
})
export class AppModule {}




