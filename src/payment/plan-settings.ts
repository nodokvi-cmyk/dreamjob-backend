import { BillingPlan } from '../shared/types/billing-plan.js';

export const STRIPE_APP_TAG = 'getdreamjob';

export type PaidPlan = BillingPlan.PLUS | BillingPlan.ELITE;

interface PlanSetting {
  priceId: string | null;
  includedCredits: number;
  vacancyPriceCents: number;
}

export const PLAN_SETTINGS = {
  [BillingPlan.PAY_AS_YOU_PUBLISH]: {
    priceId: null,
    includedCredits: 0,
    vacancyPriceCents: 500,
  },
  [BillingPlan.PLUS]: {
    priceId: 'price_1UYFJ6LQGK6RLTYUyhYq35XL',
    includedCredits: 15,
    vacancyPriceCents: 300,
  },
  [BillingPlan.ELITE]: {
    priceId: 'price_1UYFLRLQGK6RLTYUqf8JExOw',
    includedCredits: 40,
    vacancyPriceCents: 200,
  },
} as const satisfies Record<BillingPlan, PlanSetting>;

export function isPaidPlan(plan: BillingPlan | undefined): plan is PaidPlan {
  return plan === BillingPlan.PLUS || plan === BillingPlan.ELITE;
}
