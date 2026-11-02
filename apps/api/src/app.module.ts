import { Module } from '@nestjs/common';
import { PlatformModule } from './modules/platform/platform.module';
import { IdentityModule } from './modules/identity/identity.module';
import { AdminModule } from './modules/admin/admin.module';

@Module({
  imports: [PlatformModule, IdentityModule, AdminModule],
})
export class AppModule {}
