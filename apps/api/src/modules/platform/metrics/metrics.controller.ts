import { Controller, Get, Res } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { MetricsService } from './metrics.service';
import type { FastifyReply } from 'fastify';

@ApiTags('Observability')
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get()
  @ApiOperation({ summary: 'Prometheus metrics scrape endpoint' })
  @ApiResponse({ status: 200, description: 'Prometheus plain text exposition format' })
  async scrapeMetrics(@Res() res: FastifyReply) {
    const metrics = await this.metricsService.getMetrics();
    res.header('Content-Type', this.metricsService.getContentType());
    return res.send(metrics);
  }
}
