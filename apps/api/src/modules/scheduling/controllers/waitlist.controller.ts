import {
  Controller,
  Post,
  Param,
  Body,
  UseGuards,
  Inject,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { WaitlistService } from '../services/waitlist.service';
import { JwtAuthGuard } from '../../identity/guards/jwt-auth.guard';
import { CurrentUser } from '../../identity/decorators/current-user.decorator';
import { JwtPayload } from '@medibook/shared';

@ApiTags('Scheduling')
@Controller('api/waitlists')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class WaitlistController {
  constructor(
    @Inject(WaitlistService) private readonly waitlistService: WaitlistService,
  ) {}

  @Post('join')
  @ApiOperation({ summary: 'Join waitlist for a doctor on a specific date' })
  async joinWaitlist(
    @Body('doctorId') doctorId: string,
    @Body('slotDate') slotDate: string,
    @Body('slotTime') slotTime: string | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.waitlistService.joinWaitlist(
      doctorId,
      user.sub,
      slotDate,
      slotTime,
    );
  }

  @Post(':id/claim')
  @ApiOperation({ summary: 'Claim a 15-minute waitlist slot offer' })
  async claimOffer(
    @Param('id') waitlistId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.waitlistService.claimWaitlistOffer(waitlistId, user.sub);
  }
}
