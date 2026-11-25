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
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { JwtPayload, JoinWaitlistSchema, UuidSchema } from '@medibook/shared';

@ApiTags('Scheduling')
@Controller('waitlists')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class WaitlistController {
  constructor(
    @Inject(WaitlistService) private readonly waitlistService: WaitlistService,
  ) {}

  @Post('join')
  @ApiOperation({ summary: 'Join waitlist for a doctor on a specific date' })
  async joinWaitlist(
    @Body(new ZodValidationPipe(JoinWaitlistSchema))
    body: { doctorId: string; slotDate: string; slotTime?: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.waitlistService.joinWaitlist(
      body.doctorId,
      user.sub,
      body.slotDate,
      body.slotTime,
    );
  }

  @Post(':id/claim')
  @ApiOperation({ summary: 'Claim a 15-minute waitlist slot offer' })
  async claimOffer(
    @Param('id', new ZodValidationPipe(UuidSchema)) waitlistId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.waitlistService.claimWaitlistOffer(waitlistId, user.sub);
  }
}
