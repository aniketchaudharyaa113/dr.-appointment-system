import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  Req,
  Inject,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../identity/guards/jwt-auth.guard';
import { RolesGuard } from '../identity/guards/roles.guard';
import { Roles } from '../identity/decorators/roles.decorator';
import { CurrentUser } from '../identity/decorators/current-user.decorator';
import { JwtPayload } from '@medibook/shared';
import { DoctorVerificationStatus } from '@prisma/client';

@ApiTags('Admin')
@Controller('api/admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@ApiBearerAuth()
export class AdminController {
  constructor(@Inject(AdminService) private readonly adminService: AdminService) {}

  @Get('doctors/pending')
  @ApiOperation({ summary: 'List all doctors awaiting verification' })
  async getPendingDoctors() {
    return this.adminService.getPendingDoctors();
  }

  @Post('doctors/:id/verify')
  @ApiOperation({ summary: 'Approve or reject doctor license' })
  async verifyDoctor(
    @Param('id') doctorId: string,
    @Body('status') status: DoctorVerificationStatus,
    @CurrentUser() admin: JwtPayload,
    @Req() req: FastifyRequest,
  ) {
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() ||
      req.ip;
    const userAgent = req.headers['user-agent'];

    return this.adminService.verifyDoctor(
      doctorId,
      status,
      admin.sub,
      ip,
      userAgent,
    );
  }
}
