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
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { getIstDateString } from '../../../common/utils/ist-time';
import {
  JwtPayload,
  DoctorSearchQuerySchema,
  DoctorSearchQuery,
  DoctorSlotsQuerySchema,
  LeaveRangeSchema,
  UuidSchema,
} from '@medibook/shared';

@ApiTags('Scheduling')
@Controller('doctors')
export class DoctorController {
  constructor(
    @Inject(DoctorService) private readonly doctorService: DoctorService,
    @Inject(SlotService) private readonly slotService: SlotService,
    @Inject(LeaveService) private readonly leaveService: LeaveService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Search doctors with filters, distance, and pg_trgm symptom matching' })
  async searchDoctors(
    @Query(new ZodValidationPipe(DoctorSearchQuerySchema)) query: DoctorSearchQuery,
  ) {
    return this.doctorService.searchDoctors({
      symptomQuery: query.symptom,
      specialty: query.specialty,
      maxFeePaise: query.maxFeePaise,
      minRating: query.minRating,
      userLat: query.userLat,
      userLng: query.userLng,
      maxDistanceKm: query.maxDistanceKm,
      sortBy: query.sortBy,
      page: query.page,
      limit: query.limit,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get doctor public profile with reviews and availability' })
  async getDoctor(@Param('id', new ZodValidationPipe(UuidSchema)) doctorId: string) {
    return this.doctorService.getDoctorById(doctorId);
  }

  @Get(':id/slots')
  @ApiOperation({ summary: 'Get slots for doctor on a specific IST date (YYYY-MM-DD) aligned to duration grid' })
  async getDoctorSlots(
    @Param('id', new ZodValidationPipe(UuidSchema)) doctorId: string,
    @Query(new ZodValidationPipe(DoctorSlotsQuerySchema)) query: { date?: string },
  ) {
    const dateStr = query.date || getIstDateString(new Date());
    return this.slotService.getDoctorSlotsForDate(doctorId, dateStr);
  }

  @Post(':id/leaves/preview')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('DOCTOR', 'ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Dry-run preview of existing bookings affected by planned leave' })
  async previewLeave(
    @Param('id', new ZodValidationPipe(UuidSchema)) doctorId: string,
    @Body(new ZodValidationPipe(LeaveRangeSchema))
    body: { startDate: string; endDate: string },
  ) {
    return this.leaveService.previewLeaveImpact(doctorId, body.startDate, body.endDate);
  }

  @Post(':id/leaves')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('DOCTOR', 'ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Apply planned leave and cascade cancellations with full auto-refunds' })
  async applyLeave(
    @Param('id', new ZodValidationPipe(UuidSchema)) doctorId: string,
    @Body(new ZodValidationPipe(LeaveRangeSchema))
    body: { startDate: string; endDate: string; reason?: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.leaveService.applyLeave(
      doctorId,
      body.startDate,
      body.endDate,
      body.reason,
      user.sub,
    );
  }
}
