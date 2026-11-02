import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
  Inject,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { DoctorService } from '../services/doctor.service';
import { SlotService } from '../services/slot.service';
import { LeaveService } from '../services/leave.service';
import { JwtAuthGuard } from '../../identity/guards/jwt-auth.guard';
import { RolesGuard } from '../../identity/guards/roles.guard';
import { Roles } from '../../identity/decorators/roles.decorator';
import { CurrentUser } from '../../identity/decorators/current-user.decorator';
import { JwtPayload } from '@medibook/shared';

@ApiTags('Scheduling')
@Controller('api/doctors')
export class DoctorController {
  constructor(
    @Inject(DoctorService) private readonly doctorService: DoctorService,
    @Inject(SlotService) private readonly slotService: SlotService,
    @Inject(LeaveService) private readonly leaveService: LeaveService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Search doctors with filters, distance, and pg_trgm symptom matching' })
  async searchDoctors(
    @Query('symptom') symptomQuery?: string,
    @Query('specialty') specialty?: string,
    @Query('maxFeePaise') maxFeePaise?: string,
    @Query('minRating') minRating?: string,
    @Query('userLat') userLat?: string,
    @Query('userLng') userLng?: string,
    @Query('maxDistanceKm') maxDistanceKm?: string,
    @Query('sortBy') sortBy?: 'FEE_ASC' | 'RATING_DESC' | 'DISTANCE_ASC' | 'EXPERIENCE_DESC',
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.doctorService.searchDoctors({
      symptomQuery,
      specialty,
      maxFeePaise: maxFeePaise ? parseInt(maxFeePaise, 10) : undefined,
      minRating: minRating ? parseFloat(minRating) : undefined,
      userLat: userLat ? parseFloat(userLat) : undefined,
      userLng: userLng ? parseFloat(userLng) : undefined,
      maxDistanceKm: maxDistanceKm ? parseFloat(maxDistanceKm) : undefined,
      sortBy,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 10,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get doctor public profile with reviews and availability' })
  async getDoctor(@Param('id') doctorId: string) {
    return this.doctorService.getDoctorById(doctorId);
  }

  @Get(':id/slots')
  @ApiOperation({ summary: 'Get slots for doctor on a specific date (YYYY-MM-DD) aligned to duration grid' })
  async getDoctorSlots(
    @Param('id') doctorId: string,
    @Query('date') dateStr: string,
  ) {
    return this.slotService.getDoctorSlotsForDate(
      doctorId,
      dateStr || new Date().toISOString().split('T')[0],
    );
  }

  @Post(':id/leaves/preview')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('DOCTOR', 'ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Dry-run preview of existing bookings affected by planned leave' })
  async previewLeave(
    @Param('id') doctorId: string,
    @Body('startDate') startDate: string,
    @Body('endDate') endDate: string,
  ) {
    return this.leaveService.previewLeaveImpact(doctorId, startDate, endDate);
  }

  @Post(':id/leaves')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('DOCTOR', 'ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Apply planned leave and cascade cancellations with full auto-refunds' })
  async applyLeave(
    @Param('id') doctorId: string,
    @Body('startDate') startDate: string,
    @Body('endDate') endDate: string,
    @Body('reason') reason: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.leaveService.applyLeave(
      doctorId,
      startDate,
      endDate,
      reason,
      user.sub,
    );
  }
}
