import {
  Controller,
  Post,
  Body,
  UseGuards,
  Inject,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../identity/guards/jwt-auth.guard';
import { RolesGuard } from '../../identity/guards/roles.guard';
import { Roles } from '../../identity/decorators/roles.decorator';
import { CurrentUser } from '../../identity/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import {
  JwtPayload,
  AiTriageQuerySchema,
  AiChatQuerySchema,
  AiCopilotNoteSchema,
} from '@medibook/shared';
import { AiClientService } from '../services/ai-client.service';

@ApiTags('AI Gateway')
@Controller('ai')
export class AiController {
  constructor(
    @Inject(AiClientService) private readonly aiService: AiClientService,
  ) {}

  @Post('triage')
  @ApiOperation({ summary: 'Emergency triage symptom screening' })
  async triage(
    @Body(new ZodValidationPipe(AiTriageQuerySchema)) body: { query: string },
  ) {
    return this.aiService.triage(body.query);
  }

  @Post('chat')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Clinical conversational RAG assistant & booking agent' })
  async chat(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(AiChatQuerySchema))
    body: {
      message: string;
      history?: Array<{ sender: string; content: string }>;
    },
  ) {
    return this.aiService.chat(body.message, user.sub, body.history);
  }

  @Post('copilot/draft-note')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('DOCTOR')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Doctor copilot: summarize consultation transcript into SOAP draft note' })
  async generateCopilotNote(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(AiCopilotNoteSchema))
    body: {
      appointmentId: string;
      patientName: string;
      messages: Array<{ sender: string; content: string }>;
    },
  ) {
    return this.aiService.summarizeNote(
      body.appointmentId,
      user.sub,
      body.patientName,
      body.messages,
    );
  }
}
