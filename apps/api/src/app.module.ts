import { Module } from '@nestjs/common';
import { PlatformModule } from './modules/platform/platform.module';
import { IdentityModule } from './modules/identity/identity.module';
import { AdminModule } from './modules/admin/admin.module';
import { SchedulingModule } from './modules/scheduling/scheduling.module';

@Module({
  imports: [PlatformModule, IdentityModule, AdminModule, SchedulingModule],
})
export class AppModule {}
