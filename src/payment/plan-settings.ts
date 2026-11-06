import { BillingPlan } from '../shared/types/billing-plan.js';

export const STRIPE_APP_TAG = 'getdreamjob';

export const AUTHENTICATION_WAIT_DAYS = 5;
export const PLAN_END_REASON_KEY = 'planEndReason';
export const PLAN_END_AUTHENTICATION = 'authentication';

export type PaidPlan = BillingPlan.PLUS | BillingPlan.ELITE;

interface PlanSetting {
  label: string;
  priceId: string | null;
  includedCredits: number;
  vacancyPriceCents: number;
}

export const PLAN_SETTINGS = {
  [BillingPlan.PAY_AS_YOU_PUBLISH]: {
    label: 'Pay as you publish',
    priceId: null,
    includedCredits: 0,
    vacancyPriceCents: 500,
  },
  [BillingPlan.PLUS]: {
    label: 'Plus',
    priceId: 'price_1UYFJ6LQGK6RLTYUyhYq35XL',
    includedCredits: 15,
    vacancyPriceCents: 300,
  },
  [BillingPlan.ELITE]: {
    label: 'Elite',
    priceId: 'price_1UYFLRLQGK6RLTYUqf8JExOw',
    includedCredits: 40,
    vacancyPriceCents: 200,
  },
} as const satisfies Record<BillingPlan, PlanSetting>;

export function isPaidPlan(plan: BillingPlan | undefined): plan is PaidPlan {
  return plan === BillingPlan.PLUS || plan === BillingPlan.ELITE;
}
