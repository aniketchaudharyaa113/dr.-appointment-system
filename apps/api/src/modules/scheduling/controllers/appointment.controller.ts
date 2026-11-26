import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { BookingService } from '../services/booking.service';
import { JwtAuthGuard } from '../../identity/guards/jwt-auth.guard';
import { CurrentUser } from '../../identity/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { RateLimit, RateLimitGuard } from '../../../common/guards/rate-limit.guard';
import {
  JwtPayload,
  HoldSlotSchema,
  HoldSlotInput,
  ReleaseSlotHoldSchema,
  ReleaseSlotHoldInput,
  BookAppointmentSchema,
  BookAppointmentInput,
  CancelAppointmentSchema,
  CancelAppointmentInput,
  CreateReviewSchema,
  CreateReviewInput,
  UuidSchema,
  MyAppointmentsQuerySchema,
  MyAppointmentsQuery,
} from '@medibook/shared';

@ApiTags('Scheduling')
@Controller('appointments')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AppointmentController {
  constructor(
    @Inject(BookingService) private readonly bookingService: BookingService,
  ) {}

  @Get('mine')
  @ApiOperation({ summary: 'List appointments for authenticated user with cursor pagination & status/date filters' })
  async getMyAppointments(
    @CurrentUser() user: JwtPayload,
    @Query(new ZodValidationPipe(MyAppointmentsQuerySchema)) query: MyAppointmentsQuery,
  ) {
    return this.bookingService.getMyAppointments(user.sub, user.role, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get appointment details by ID (owner, doctor, or admin)' })
  async getAppointment(
    @Param('id', new ZodValidationPipe(UuidSchema)) appointmentId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.bookingService.getAppointmentById(appointmentId, user.sub, user.role);
  }

  @Post('hold')
  @UseGuards(RateLimitGuard)
  @RateLimit({ keyPrefix: 'appt_hold', limit: 20, windowSeconds: 60 })
  @ApiOperation({ summary: 'Hold a slot for 10 minutes with Redis unguessable token lease' })
  async holdSlot(
    @Body(new ZodValidationPipe(HoldSlotSchema)) body: HoldSlotInput,
    @CurrentUser() user: JwtPayload,
  ) {
    if (user.role !== 'PATIENT') {
      throw new ForbiddenException('Only patients are allowed to hold consultation slots');
    }
    return this.bookingService.holdSlot(body.doctorId, body.slotTime, user.sub);
  }

  @Delete('hold')
  @ApiOperation({ summary: 'Release currently held slot immediately (P1-8)' })
  async releaseHold(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(ReleaseSlotHoldSchema.optional())) body?: ReleaseSlotHoldInput,
  ) {
    if (user.role !== 'PATIENT') {
      throw new ForbiddenException('Only patients have slot holds');
    }
    return this.bookingService.releaseHold(user.sub, body?.doctorId, body?.slotTime);
  }

  @Post('book')
  @UseGuards(RateLimitGuard)
  @RateLimit({ keyPrefix: 'appt_book', limit: 15, windowSeconds: 60 })
  @ApiOperation({ summary: 'Create PENDING_PAYMENT booking after verifying Redis hold token' })
  async bookAppointment(
    @Body(new ZodValidationPipe(BookAppointmentSchema)) body: BookAppointmentInput,
    @CurrentUser() user: JwtPayload,
  ) {
    if (user.role !== 'PATIENT') {
      throw new ForbiddenException('Only patients can book appointments');
    }
    return this.bookingService.bookAppointment(
      body.doctorId,
      body.slotTime,
      user.sub,
      body.holdToken,
      body.consultationMode,
      body.notes,
      body.idempotencyKey,
    );
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel appointment and immediately free slot for rebooking' })
  async cancelAppointment(
    @Param('id', new ZodValidationPipe(UuidSchema)) appointmentId: string,
    @Body(new ZodValidationPipe(CancelAppointmentSchema.optional()))
    body: CancelAppointmentInput | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.bookingService.cancelAppointment(
      appointmentId,
      user.sub,
      body?.reason,
      user.role,
    );
  }

  @Post(':id/review')
  @ApiOperation({ summary: 'Submit rating and review for a completed appointment' })
  async reviewAppointment(
    @Param('id', new ZodValidationPipe(UuidSchema)) appointmentId: string,
    @Body(new ZodValidationPipe(CreateReviewSchema)) body: CreateReviewInput,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.bookingService.reviewAppointment(
      appointmentId,
      user.sub,
      body.rating,
      body.comment,
    );
  }
}
