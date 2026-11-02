import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { LoginRateLimitGuard } from './rate-limit/login-rate-limit.guard';

@Module({
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, RolesGuard, LoginRateLimitGuard],
  exports: [AuthService, JwtAuthGuard, RolesGuard],
})
export class IdentityModule {}
