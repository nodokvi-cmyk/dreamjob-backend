import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import Stripe from 'stripe';
import { Company, companySchema } from '../companies/schema/company.schema.js';
import { EmailSenderModule } from '../email-sender/email-sender.module.js';
import { Vacancy, vacancySchema } from '../vacancies/schema/vacancy.schema.js';
import { PaymentController } from './payment.controller.js';
import { PaymentService } from './payment.service.js';
import { Payment, paymentSchema } from './schema/payment.schema.js';
import { STRIPE_CLIENT } from './stripe-client.js';
import { VacancyBillingService } from './vacancy-billing.service.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Company.name, schema: companySchema },
      { name: Payment.name, schema: paymentSchema },
      { name: Vacancy.name, schema: vacancySchema },
    ]),
    EmailSenderModule,
  ],
  controllers: [PaymentController],
  providers: [
    PaymentService,
    VacancyBillingService,
    {
      provide: STRIPE_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new Stripe(config.getOrThrow<string>('STRIPE_API_KEY')),
    },
  ],
  exports: [VacancyBillingService],
})
export class PaymentModule {}
