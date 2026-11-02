import {
  Controller,
  Post,
  Param,
  Body,
  UseGuards,
  Inject,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { BookingService } from '../services/booking.service';
import { JwtAuthGuard } from '../../identity/guards/jwt-auth.guard';
import { CurrentUser } from '../../identity/decorators/current-user.decorator';
import { JwtPayload, ConsultationMode } from '@medibook/shared';

@ApiTags('Scheduling')
@Controller('api/appointments')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AppointmentController {
  constructor(
    @Inject(BookingService) private readonly bookingService: BookingService,
  ) {}

  @Post('hold')
  @ApiOperation({ summary: 'Hold a slot for 10 minutes with Redis lease' })
  async holdSlot(
    @Body('doctorId') doctorId: string,
    @Body('slotTime') slotTime: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.bookingService.holdSlot(doctorId, slotTime, user.sub);
  }

  @Post('book')
  @ApiOperation({ summary: 'Confirm booking with atomic daily reference MB-YYYYMMDD-NNN' })
  async bookAppointment(
    @Body('doctorId') doctorId: string,
    @Body('slotTime') slotTime: string,
    @Body('consultationMode') consultationMode: ConsultationMode = 'VIDEO',
    @Body('notes') notes: string | undefined,
    @Body('idempotencyKey') idempotencyKey: string | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.bookingService.bookAppointment(
      doctorId,
      slotTime,
      user.sub,
      consultationMode,
      notes,
      idempotencyKey,
    );
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel appointment and immediately free slot for rebooking' })
  async cancelAppointment(
    @Param('id') appointmentId: string,
    @Body('reason') reason: string | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.bookingService.cancelAppointment(
      appointmentId,
      user.sub,
      reason,
    );
  }
}
