import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { Company } from '../../companies/schema/company.schema.js';
import { BillingPlan } from '../../shared/types/billing-plan.js';

export enum PaymentKind {
  SUBSCRIPTION = 'subscription',
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
}

export type PaymentDocument = HydratedDocument<Payment>;

export const paymentSchema = SchemaFactory.createForClass(Payment);
