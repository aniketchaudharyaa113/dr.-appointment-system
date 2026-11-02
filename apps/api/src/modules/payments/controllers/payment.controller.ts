import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Headers,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { PaymentService } from '../services/payment.service';
import { JwtAuthGuard } from '../../identity/guards/jwt-auth.guard';
import { RolesGuard } from '../../identity/guards/roles.guard';
import { Roles } from '../../identity/decorators/roles.decorator';
import { CurrentUser } from '../../identity/decorators/current-user.decorator';

@ApiTags('Payments')
@Controller('payments')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post('checkout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Initiate a payment order for an appointment' })
  async checkout(
    @CurrentUser() user: any,
    @Body() body: { appointmentId: string; idempotencyKey: string },
  ) {
    if (!body.appointmentId || !body.idempotencyKey) {
      throw new BadRequestException('appointmentId and idempotencyKey are required');
    }
    return this.paymentService.createCheckout(
      user.userId,
      body.appointmentId,
      body.idempotencyKey,
    );
  }

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Payment provider webhook inbox' })
  async handleWebhook(
    @Req() req: FastifyRequest,
    @Headers('x-razorpay-signature') razorpaySig?: string,
    @Headers('stripe-signature') stripeSig?: string,
    @Headers('x-signature') genericSig?: string,
  ) {
    const signature = razorpaySig || stripeSig || genericSig || '';

    // Fastify request raw body or parsed body string
    let rawBody = (req as any).rawBody;
    if (!rawBody) {
      rawBody = JSON.stringify(req.body);
    }

    return this.paymentService.processWebhook(rawBody, signature);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get payment details' })
  async getPayment(@Param('id') id: string) {
    return this.paymentService.findById(id);
  }


  @Post(':id/refund')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Request refund for a captured payment' })
  async refund(
    @CurrentUser() user: any,
    @Param('id') paymentId: string,
    @Body() body: { reason?: string },
  ) {
    const isDoctor = user.role === 'DOCTOR';
    return this.paymentService.refundPayment(
      paymentId,
      body.reason || 'Requested by user',
      isDoctor,
    );
  }

  @Post('reconcile')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Trigger stuck payment reconciliation' })
  async reconcile() {
    const count = await this.paymentService.reconcileStuckPayments();
    return { reconciledCount: count };
  }
}
