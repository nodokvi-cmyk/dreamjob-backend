import type { Model } from 'mongoose';
import type Stripe from 'stripe';
import type {
  Company,
  CompanyDocument,
} from '../companies/schema/company.schema.js';
import { STRIPE_APP_TAG } from './plan-settings.js';

export async function ensureStripeCustomer(
  stripe: Stripe,
  companyModel: Model<Company>,
  company: CompanyDocument,
): Promise<string> {
  if (company.stripeCustomerId) return company.stripeCustomerId;

  const customer = await stripe.customers.create({
    email: company.email,
    name: company.companyName || undefined,
    metadata: { app: STRIPE_APP_TAG, companyId: company.id },
  });

  const saved = await companyModel
    .findOneAndUpdate(
      { _id: company._id, stripeCustomerId: { $exists: false } },
      { $set: { stripeCustomerId: customer.id } },
      { new: true },
    )
    .select('+stripeCustomerId');
  if (saved?.stripeCustomerId) return saved.stripeCustomerId;

  const current = await companyModel
    .findById(company._id)
    .select('+stripeCustomerId');
  return current?.stripeCustomerId ?? customer.id;
}
