import { Module } from '@nestjs/common';
import { AiClientService } from './services/ai-client.service';
import { AiController } from './controllers/ai.controller';

@Module({
  controllers: [AiController],
  providers: [AiClientService],
  exports: [AiClientService],
})
export class AiGatewayModule {}
