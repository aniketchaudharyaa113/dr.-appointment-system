import { Module } from '@nestjs/common';
import { PlatformModule } from './modules/platform/platform.module';

@Module({
  imports: [PlatformModule],
})
export class AppModule {}
