import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../identity/guards/jwt-auth.guard';
import { CurrentUser } from '../../identity/decorators/current-user.decorator';
import { JwtPayload } from '@medibook/shared';
import { ClinicalService } from '../services/clinical.service';

@ApiTags('Patients')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('patients')
export class PatientClinicalController {
  constructor(
    @Inject(ClinicalService) private readonly clinicalService: ClinicalService,
  ) {}

  @Get('health-passport')
  @ApiOperation({ summary: 'Get longitudinal Health Passport (vitals, lab orders, prescriptions)' })
  async getHealthPassport(@CurrentUser() user: JwtPayload) {
    return this.clinicalService.getHealthPassport(user.sub);
  }
}
