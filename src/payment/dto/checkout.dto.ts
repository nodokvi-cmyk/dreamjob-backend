import { IsIn } from 'class-validator';
import { BillingPlan } from '../../shared/types/billing-plan.js';
import type { PaidPlan } from '../plan-settings.js';

export class CheckoutDto {
  @IsIn([BillingPlan.PLUS, BillingPlan.ELITE])
  plan!: PaidPlan;
}
