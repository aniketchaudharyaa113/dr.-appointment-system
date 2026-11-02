import { Module } from '@nestjs/common';
import { PaymentController } from './controllers/payment.controller';
import { PaymentService } from './services/payment.service';
import { LedgerService } from './services/ledger.service';
import { FakePaymentProvider } from './providers/fake.provider';
import { RazorpayProvider } from './providers/razorpay.provider';
import { StripeProvider } from './providers/stripe.provider';
import { PAYMENT_PROVIDER } from './providers/payment-provider.interface';
import { PlatformModule } from '../platform/platform.module';

@Module({
  imports: [PlatformModule],
  controllers: [PaymentController],
  providers: [
    LedgerService,
    PaymentService,
    FakePaymentProvider,
    RazorpayProvider,
    StripeProvider,
    {
      provide: PAYMENT_PROVIDER,
      useFactory: (
        fake: FakePaymentProvider,
        rzp: RazorpayProvider,
        stripe: StripeProvider,
      ) => {
        const selected = process.env.PAYMENT_PROVIDER?.toUpperCase();
        if (selected === 'RAZORPAY') return rzp;
        if (selected === 'STRIPE') return stripe;
        return fake;
      },
      inject: [FakePaymentProvider, RazorpayProvider, StripeProvider],
    },
  ],
  exports: [PaymentService, LedgerService, PAYMENT_PROVIDER],
})
export class PaymentsModule {}
