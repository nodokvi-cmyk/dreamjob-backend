import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { Company } from '../../companies/schema/company.schema.js';
import { BillingPlan } from '../../shared/types/billing-plan.js';
import { Vacancy } from '../../vacancies/schema/vacancy.schema.js';

export enum PaymentKind {
  SUBSCRIPTION = 'subscription',
  VACANCY = 'vacancy',
}

export enum VacancyPaymentPurpose {
  SUBMIT = 'submit',
  EXTEND = 'extend',
}

@Schema({ timestamps: true })
export class Payment {
  @Prop({ type: String, required: true, unique: true })
  stripeSessionId!: string;

  @Prop({ type: Types.ObjectId, ref: Company.name, required: true })
  company!: Types.ObjectId;

  @Prop({ type: String, enum: PaymentKind, required: true })
  kind!: PaymentKind;

  @Prop({ type: String, enum: BillingPlan, required: false })
  plan?: BillingPlan;

  @Prop({ type: Types.ObjectId, ref: Vacancy.name, required: false })
  vacancy?: Types.ObjectId;

  @Prop({ type: String, enum: VacancyPaymentPurpose, required: false })
  purpose?: VacancyPaymentPurpose;

  @Prop({ type: Number, required: false })
  amount?: number;
}

export type PaymentDocument = HydratedDocument<Payment>;

export const paymentSchema = SchemaFactory.createForClass(Payment);
