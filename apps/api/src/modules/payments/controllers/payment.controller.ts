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
  Inject,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { PaymentService } from '../services/payment.service';
import { JwtAuthGuard } from '../../identity/guards/jwt-auth.guard';
import { RolesGuard } from '../../identity/guards/roles.guard';
import { Roles } from '../../identity/decorators/roles.decorator';
import { CurrentUser } from '../../identity/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import {
  JwtPayload,
  CreatePaymentOrderSchema,
  CreatePaymentOrderInput,
  RefundPaymentSchema,
  DevSimulateWebhookSchema,
  UuidSchema,
} from '@medibook/shared';

@ApiTags('Payments')
@Controller('payments')
export class PaymentController {
  constructor(
    @Inject(PaymentService) private readonly paymentService: PaymentService,
  ) {}

  @Post('checkout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Initiate a payment order for a PENDING_PAYMENT appointment' })
  async checkout(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(CreatePaymentOrderSchema))
    body: CreatePaymentOrderInput,
  ) {
    return this.paymentService.createCheckout(
      user.sub,
      body.appointmentId,
      body.idempotencyKey,
    );
  }

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Payment provider webhook inbox (verifies HMAC on raw bytes)' })
  async handleWebhook(
    @Req() req: FastifyRequest,
    @Headers('x-razorpay-signature') razorpaySig?: string,
    @Headers('stripe-signature') stripeSig?: string,
    @Headers('x-signature') genericSig?: string,
  ) {
    const signature = razorpaySig || stripeSig || genericSig || '';
    const rawBody = (req as any).rawBody as Buffer | string | undefined;

    if (!rawBody) {
      throw new BadRequestException('Raw webhook payload body is required');
    }

    return this.paymentService.processWebhook(rawBody, signature);
  }

  @Post('dev/simulate-webhook')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Dev/FakeProvider only: sign and dispatch a real webhook payload' })
  async devSimulateWebhook(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(DevSimulateWebhookSchema))
    body: {
      paymentId?: string;
      providerOrderId?: string;
      event: 'payment.captured' | 'payment.failed';
    },
  ) {
    if (!body.paymentId && !body.providerOrderId) {
      throw new BadRequestException('paymentId or providerOrderId is required');
    }
    return this.paymentService.devSimulateWebhook({
      paymentId: body.paymentId,
      providerOrderId: body.providerOrderId,
      event: body.event,
      actorId: user.sub,
      actorRole: user.role,
    });
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get payment details (owner, doctor, or admin only)' })
  async getPayment(
    @Param('id', new ZodValidationPipe(UuidSchema)) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.paymentService.findById(id, user.sub, user.role);
  }

  @Post(':id/refund')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Request refund for a captured payment (owner, doctor, or admin only)' })
  async refund(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ZodValidationPipe(UuidSchema)) paymentId: string,
    @Body(new ZodValidationPipe(RefundPaymentSchema.optional()))
    body?: { reason?: string },
  ) {
    return this.paymentService.refundPayment(
      paymentId,
      body?.reason || 'Requested by user',
      user.sub,
      user.role,
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
