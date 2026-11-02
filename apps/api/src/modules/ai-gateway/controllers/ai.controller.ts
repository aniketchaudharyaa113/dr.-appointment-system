import {
  Controller,
  Post,
  Body,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../identity/guards/jwt-auth.guard';
import { RolesGuard } from '../../identity/guards/roles.guard';
import { Roles } from '../../identity/decorators/roles.decorator';
import { CurrentUser } from '../../identity/decorators/current-user.decorator';
import { AiClientService } from '../services/ai-client.service';

@ApiTags('AI Gateway')
@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiClientService) {}

  @Post('triage')
  @ApiOperation({ summary: 'Emergency triage symptom screening' })
  async triage(@Body() body: { query: string; userId?: string }) {
    if (!body.query) throw new BadRequestException('query is required');
    return this.aiService.triage(body.query, body.userId);
  }

  @Post('chat')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Clinical conversational RAG assistant & booking agent' })
  async chat(
    @CurrentUser() user: any,
    @Body()
    body: {
      message: string;
      history?: Array<{ sender: string; content: string }>;
    },
  ) {
    if (!body.message) throw new BadRequestException('message is required');
    return this.aiService.chat(body.message, user.userId, body.history);
  }

  @Post('copilot/draft-note')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('DOCTOR')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Doctor copilot: summarize consultation transcript into SOAP draft note' })
  async generateCopilotNote(
    @CurrentUser() user: any,
    @Body()
    body: {
      appointmentId: string;
      patientName: string;
      messages: Array<{ sender: string; content: string }>;
    },
  ) {
    if (!body.appointmentId || !body.patientName) {
      throw new BadRequestException('appointmentId and patientName are required');
    }
    return this.aiService.summarizeNote(
      body.appointmentId,
      user.userId,
      body.patientName,
      body.messages || [],
    );
  }
}
