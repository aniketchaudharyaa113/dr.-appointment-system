import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Inject,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { z } from 'zod';
import { JwtAuthGuard } from '../../identity/guards/jwt-auth.guard';
import { RolesGuard } from '../../identity/guards/roles.guard';
import { Roles } from '../../identity/decorators/roles.decorator';
import { CurrentUser } from '../../identity/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { RateLimit, RateLimitGuard } from '../../../common/guards/rate-limit.guard';
import { env } from '../../../common/config/env.schema';
import {
  JwtPayload,
  UuidSchema,
  AmbulanceRequestSchema,
  AmbulanceRequestInput,
  UpdateTripStatusSchema,
  DriverTelemetrySchema,
} from '@medibook/shared';
import { AmbulanceService } from '../services/ambulance.service';

const EmergencyQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
});

@ApiTags('Ambulance')
@Controller('ambulance')
export class AmbulanceController {
  constructor(
    @Inject(AmbulanceService) private readonly ambulanceService: AmbulanceService,
  ) {}

  @Get('emergency')
  @ApiOperation({
    summary:
      'Get emergency hotlines and nearby hospitals (public, works with 0 drivers)',
  })
  getEmergencyInfo(
    @Query(new ZodValidationPipe(EmergencyQuerySchema))
    query: { lat?: number; lng?: number },
  ) {
    return this.ambulanceService.getEmergencyInfo(query.lat, query.lng);
  }

  @Get('drivers/online')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'List active ambulance units with live Redis GEO coordinates and heartbeats',
  })
  getOnlineDrivers(
    @CurrentUser() user: JwtPayload,
    @Query(new ZodValidationPipe(EmergencyQuerySchema))
    query: { lat?: number; lng?: number },
  ) {
    return this.ambulanceService.getOnlineDrivers(query.lat, query.lng, user.role);
  }

  @Get('requests/active')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get current active emergency ambulance request for the signed-in user',
  })
  getActiveRequest(@CurrentUser() user: JwtPayload) {
    return this.ambulanceService.getActiveRequest(user.sub);
  }

  @Get('requests/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get ambulance request status & driver info' })
  getRequest(
    @Param('id', new ZodValidationPipe(UuidSchema)) requestId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.ambulanceService.getRequestById(requestId, user.sub, user.role);
  }

  @Post('requests')
  @UseGuards(JwtAuthGuard, RateLimitGuard)
  @RateLimit({ keyPrefix: 'ambulance_req', limit: 10, windowSeconds: 60 })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Patient initiates emergency ambulance dispatch' })
  async createRequest(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(AmbulanceRequestSchema))
    body: AmbulanceRequestInput,
  ) {
    return this.ambulanceService.createRequest(
      user.sub,
      body.pickupLat,
      body.pickupLng,
      body.pickupAddress,
    );
  }

  @Post('requests/:id/cancel')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Patient or Admin cancels an active ambulance request' })
  async cancelRequest(
    @Param('id', new ZodValidationPipe(UuidSchema)) requestId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.ambulanceService.cancelRequest(requestId, user.sub, user.role);
  }

  @Post('requests/:id/accept')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('DRIVER')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Driver atomically accepts an offered ambulance request' })
  async acceptRequest(
    @Param('id', new ZodValidationPipe(UuidSchema)) requestId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.ambulanceService.acceptRequest(requestId, user.sub);
  }

  @Post('requests/:id/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('DRIVER')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Driver updates trip status (EN_ROUTE, ARRIVED, COMPLETED)',
  })
  async updateTripStatus(
    @Param('id', new ZodValidationPipe(UuidSchema)) requestId: string,
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(UpdateTripStatusSchema))
    body: { status: 'EN_ROUTE' | 'ARRIVED' | 'COMPLETED' },
  ) {
    return this.ambulanceService.updateTripStatus(
      requestId,
      user.sub,
      body.status,
    );
  }

  @Get('driver/offers')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('DRIVER')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Driver fetches pending offers and assigned trips' })
  async getDriverOffers(@CurrentUser() user: JwtPayload) {
    return this.ambulanceService.getDriverOffers(user.sub);
  }

  @Post('driver/telemetry')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('DRIVER')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Driver streams location and heartbeat to Redis GEO',
  })
  async updateDriverTelemetry(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(DriverTelemetrySchema))
    body: {
      latitude: number;
      longitude: number;
      isOnline?: boolean;
    },
  ) {
    return this.ambulanceService.updateDriverLocation(
      user.sub,
      body.latitude,
      body.longitude,
      body.isOnline ?? true,
    );
  }

  @Post('dev/requests/:id/simulate-trip')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'FAKE-mode helper that runs a real driver accept + live telemetry stream for the request',
  })
  async simulateTrip(
    @Param('id', new ZodValidationPipe(UuidSchema)) requestId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    if (!env.ENABLE_DEV_ENDPOINTS) {
      throw new NotFoundException('Dev simulation endpoints are disabled');
    }
    return this.ambulanceService.simulateDriverTrip(requestId, user.sub, user.role);
  }
}
