import { Logger, NotFoundException } from '@nestjs/common';
import type { Model } from 'mongoose';
import type Stripe from 'stripe';
import type {
  Company,
  CompanyDocument,
} from '../companies/schema/company.schema.js';
import { STRIPE_APP_TAG } from './plan-settings.js';

const logger = new Logger('StripeCustomer');

async function deleteCustomerQuietly(
  stripe: Stripe,
  customerId: string,
): Promise<void> {
  try {
    await stripe.customers.del(customerId);
  } catch (error: unknown) {
    logger.warn(
      error instanceof Error ? error.message : 'Could not delete customer',
    );
  }
}

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

  await deleteCustomerQuietly(stripe, customer.id);

  const current = await companyModel
    .findById(company._id)
    .select('+stripeCustomerId');
  if (!current?.stripeCustomerId) {
    throw new NotFoundException('Company not found');
  }
  return current.stripeCustomerId;
}
