import { Controller, Patch, Param, Body, UseGuards, Inject } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../identity/guards/jwt-auth.guard';
import { CurrentUser } from '../../identity/decorators/current-user.decorator';
import { JwtPayload, UuidSchema, UpdateLabResultsSchema, UpdateLabResultsInput } from '@medibook/shared';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { ClinicalService } from '../services/clinical.service';

@ApiTags('Lab Orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('lab-orders')
export class LabOrderController {
  constructor(
    @Inject(ClinicalService) private readonly clinicalService: ClinicalService,
  ) {}

  @Patch(':id')
  @ApiOperation({ summary: 'Ordering doctor updates lab order results and marks complete' })
  async updateLabResults(
    @Param('id', new ZodValidationPipe(UuidSchema)) id: string,
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(UpdateLabResultsSchema)) body: UpdateLabResultsInput,
  ) {
    return this.clinicalService.updateLabResults(id, user.sub, body);
  }
}
