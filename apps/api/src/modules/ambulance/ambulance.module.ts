import { Module } from '@nestjs/common';
import { PlatformModule } from '../platform/platform.module';
import { AmbulanceService } from './services/ambulance.service';
import { AmbulanceGateway } from './gateways/ambulance.gateway';
import { AmbulanceController } from './controllers/ambulance.controller';

@Module({
  imports: [PlatformModule],
  controllers: [AmbulanceController],
  providers: [AmbulanceService, AmbulanceGateway],
  exports: [AmbulanceService],
})
export class AmbulanceModule {}
