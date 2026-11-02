import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../identity/guards/jwt-auth.guard';
import { RolesGuard } from '../../identity/guards/roles.guard';
import { Roles } from '../../identity/decorators/roles.decorator';
import { CurrentUser } from '../../identity/decorators/current-user.decorator';
import { AmbulanceService } from '../services/ambulance.service';

@ApiTags('Ambulance')
@Controller('ambulance')
export class AmbulanceController {
  constructor(private readonly ambulanceService: AmbulanceService) {}

  @Get('emergency')
  @ApiOperation({ summary: 'Get emergency hotlines and nearby hospitals (public, works with 0 drivers)' })
  getEmergencyInfo(
    @Query('lat') lat?: string,
    @Query('lng') lng?: string,
  ) {
    const latNum = lat ? parseFloat(lat) : undefined;
    const lngNum = lng ? parseFloat(lng) : undefined;
    return this.ambulanceService.getEmergencyInfo(latNum, lngNum);
  }

  @Post('requests')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Patient initiates emergency ambulance dispatch' })
  async createRequest(
    @CurrentUser() user: any,
    @Body()
    body: {
      pickupLat: number;
      pickupLng: number;
      pickupAddress: string;
    },
  ) {
    if (!body.pickupLat || !body.pickupLng || !body.pickupAddress) {
      throw new BadRequestException('pickupLat, pickupLng, and pickupAddress are required');
    }
    return this.ambulanceService.createRequest(
      user.userId,
      body.pickupLat,
      body.pickupLng,
      body.pickupAddress,
    );
  }

  @Post('requests/:id/accept')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('DRIVER')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Driver atomically accepts an offered ambulance request' })
  async acceptRequest(
    @Param('id') requestId: string,
    @CurrentUser() user: any,
  ) {
    return this.ambulanceService.acceptRequest(requestId, user.userId);
  }

  @Post('requests/:id/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('DRIVER')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Driver updates trip status (EN_ROUTE, ARRIVED, COMPLETED)' })
  async updateTripStatus(
    @Param('id') requestId: string,
    @CurrentUser() user: any,
    @Body() body: { status: 'EN_ROUTE' | 'ARRIVED' | 'COMPLETED' },
  ) {
    if (!body.status) throw new BadRequestException('status is required');
    return this.ambulanceService.updateTripStatus(requestId, user.userId, body.status);
  }

  @Post('driver/telemetry')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('DRIVER')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Driver streams location and heartbeat to Redis GEO' })
  async updateDriverTelemetry(
    @CurrentUser() user: any,
    @Body()
    body: {
      latitude: number;
      longitude: number;
      isOnline: boolean;
    },
  ) {
    if (body.latitude === undefined || body.longitude === undefined || body.isOnline === undefined) {
      throw new BadRequestException('latitude, longitude, and isOnline are required');
    }
    return this.ambulanceService.updateDriverLocation(
      user.userId,
      body.latitude,
      body.longitude,
      body.isOnline,
    );
  }
}
