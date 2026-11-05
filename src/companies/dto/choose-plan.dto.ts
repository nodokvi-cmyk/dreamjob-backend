import { Equals } from 'class-validator';
import { BillingPlan } from '../../shared/types/billing-plan.js';

export class ChoosePlanDto {
  @Equals(BillingPlan.PAY_AS_YOU_PUBLISH)
  plan!: BillingPlan.PAY_AS_YOU_PUBLISH;
}
