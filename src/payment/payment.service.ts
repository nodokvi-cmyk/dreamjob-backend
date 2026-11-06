import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import Stripe from 'stripe';
import {
  Company,
  CompanyDocument,
} from '../companies/schema/company.schema.js';
import { isDuplicateKeyError } from '../shared/mongo/is-duplicate-key-error.js';
import { BillingPlan } from '../shared/types/billing-plan.js';
import {
  isPaidPlan,
  PaidPlan,
  PLAN_SETTINGS,
  STRIPE_APP_TAG,
} from './plan-settings.js';
import { Payment, PaymentKind } from './schema/payment.schema.js';
import { STRIPE_CLIENT } from './stripe-client.js';

function idOf(value: string | { id: string } | null | undefined) {
  if (!value) return undefined;
  return typeof value === 'string' ? value : value.id;
}

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe,
    private readonly config: ConfigService,
    @InjectModel(Company.name)
    private readonly companyModel: Model<Company>,
    @InjectModel(Payment.name)
    private readonly paymentModel: Model<Payment>,
  ) {}

  async createPlanCheckout(companyId: string, plan: PaidPlan) {
    const company = await this.companyModel
      .findById(companyId)
      .select('+stripeCustomerId');
    if (!company) throw new NotFoundException('Company not found');
    if (isPaidPlan(company.plan)) {
      throw new BadRequestException(
        'Cancel your current plan before choosing another one',
      );
    }

    const customerId = await this.ensureCustomer(company);
    const frontend = this.config.getOrThrow<string>('FRONTEND_URI');
    const metadata = { app: STRIPE_APP_TAG, companyId, plan };

    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: companyId,
      line_items: [{ price: PLAN_SETTINGS[plan].priceId, quantity: 1 }],
      metadata,
      subscription_data: { metadata },
      success_url: `${frontend}/company/billing?status=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontend}/company/billing?status=cancelled`,
    });
    if (!session.url) {
      throw new InternalServerErrorException('Could not start checkout');
    }

    return { url: session.url };
  }

  async createPortalSession(companyId: string) {
    const company = await this.companyModel
      .findById(companyId)
      .select('+stripeCustomerId');
    if (!company) throw new NotFoundException('Company not found');
    if (!company.stripeCustomerId) {
      throw new BadRequestException('No billing account yet');
    }

    const frontend = this.config.getOrThrow<string>('FRONTEND_URI');
    const session = await this.stripe.billingPortal.sessions.create({
      customer: company.stripeCustomerId,
      return_url: `${frontend}/company/billing`,
    });

    return { url: session.url };
  }

  async confirmCheckout(companyId: string, sessionId: string) {
    const session = await this.retrieveSession(sessionId);
    if (
      session.metadata?.app !== STRIPE_APP_TAG ||
      session.metadata.companyId !== companyId
    ) {
      throw new NotFoundException('Checkout session not found');
    }

    await this.fulfillSession(session);

    const company = await this.companyModel.findById(companyId);
    if (!company) throw new NotFoundException('Company not found');

    return {
      paid: session.payment_status === 'paid',
      plan: company.plan,
      credits: company.credits,
      purchasedCredits: company.purchasedCredits,
      planRenewsAt: company.planRenewsAt,
      planEndsAtPeriodEnd: company.planEndsAtPeriodEnd,
    };
  }

  async handleWebhook(
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ) {
    if (!rawBody || !signature) {
      throw new BadRequestException('Missing body or signature');
    }

    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        this.config.getOrThrow<string>('STRIPE_WEBHOOK_SECRET'),
      );
    } catch (error: unknown) {
      this.logger.warn(
        error instanceof Error ? error.message : 'Invalid webhook signature',
      );
      throw new BadRequestException('Invalid signature');
    }

    switch (event.type) {
      case 'checkout.session.completed':
        await this.fulfillSession(event.data.object);
        break;
      case 'invoice.paid':
        await this.renewPlan(event.data.object);
        break;
      case 'customer.subscription.updated':
        await this.markPlanEnding(event.data.object);
        break;
      case 'customer.subscription.deleted':
        await this.endPlan(event.data.object);
        break;
      default:
        break;
    }

    return { received: true };
  }

  private async retrieveSession(sessionId: string) {
    try {
      return await this.stripe.checkout.sessions.retrieve(sessionId);
    } catch (error: unknown) {
      this.logger.warn(
        error instanceof Error ? error.message : 'Session lookup failed',
      );
      throw new NotFoundException('Checkout session not found');
    }
  }

  private async ensureCustomer(company: CompanyDocument) {
    if (company.stripeCustomerId) return company.stripeCustomerId;

    const customer = await this.stripe.customers.create({
      email: company.email,
      name: company.companyName || undefined,
      metadata: { app: STRIPE_APP_TAG, companyId: company.id },
    });

    const saved = await this.companyModel
      .findOneAndUpdate(
        { _id: company._id, stripeCustomerId: { $exists: false } },
        { $set: { stripeCustomerId: customer.id } },
        { new: true },
      )
      .select('+stripeCustomerId');
    if (saved?.stripeCustomerId) return saved.stripeCustomerId;

    const current = await this.companyModel
      .findById(company._id)
      .select('+stripeCustomerId');
    return current?.stripeCustomerId ?? customer.id;
  }

  private async claimPayment(
    sessionId: string,
    companyId: string,
    kind: PaymentKind,
    plan: PaidPlan,
  ) {
    try {
      const existing = await this.paymentModel.findOneAndUpdate(
        { stripeSessionId: sessionId },
        {
          $setOnInsert: {
            company: new Types.ObjectId(companyId),
            kind,
            plan,
          },
        },
        { upsert: true, new: false },
      );
      return existing === null;
    } catch (error: unknown) {
      if (isDuplicateKeyError(error)) return false;
      throw error;
    }
  }

  private async fulfillSession(session: Stripe.Checkout.Session) {
    if (session.metadata?.app !== STRIPE_APP_TAG) return;
    if (session.payment_status !== 'paid') return;

    const { companyId, plan } = session.metadata;
    if (!companyId || !Types.ObjectId.isValid(companyId)) return;
    if (plan !== BillingPlan.PLUS && plan !== BillingPlan.ELITE) return;

    const subscriptionId = idOf(session.subscription);
    if (!subscriptionId) return;

    const claimed = await this.claimPayment(
      session.id,
      companyId,
      PaymentKind.SUBSCRIPTION,
      plan,
    );
    if (!claimed) return;

    try {
      const subscription =
        await this.stripe.subscriptions.retrieve(subscriptionId);
      const periodEnd = subscription.items.data[0]?.current_period_end;

      await this.companyModel.updateOne(
        { _id: companyId },
        {
          $set: {
            plan,
            credits: PLAN_SETTINGS[plan].includedCredits,
            planRenewsAt:
              periodEnd === undefined ? undefined : new Date(periodEnd * 1000),
            planEndsAtPeriodEnd: false,
            stripeSubscriptionId: subscriptionId,
            ...(idOf(session.customer)
              ? { stripeCustomerId: idOf(session.customer) }
              : {}),
          },
        },
      );
    } catch (error: unknown) {
      await this.paymentModel.deleteOne({ stripeSessionId: session.id });
      throw error;
    }
  }

  private async renewPlan(invoice: Stripe.Invoice) {
    if (invoice.billing_reason !== 'subscription_cycle') return;

    const details = invoice.parent?.subscription_details;
    if (details?.metadata?.app !== STRIPE_APP_TAG) return;

    const subscriptionId = idOf(details.subscription);
    const periodEnd = invoice.lines.data[0]?.period.end;
    if (!subscriptionId || periodEnd === undefined) return;

    const company = await this.companyModel.findOne({
      stripeSubscriptionId: subscriptionId,
    });
    if (!company || !isPaidPlan(company.plan)) return;

    const renewsAt = new Date(periodEnd * 1000);
    await this.companyModel.updateOne(
      {
        _id: company._id,
        $or: [
          { planRenewsAt: { $exists: false } },
          { planRenewsAt: { $lt: renewsAt } },
        ],
      },
      {
        $set: {
          credits: PLAN_SETTINGS[company.plan].includedCredits,
          planRenewsAt: renewsAt,
        },
      },
    );
  }

  private async markPlanEnding(subscription: Stripe.Subscription) {
    if (subscription.metadata.app !== STRIPE_APP_TAG) return;

    await this.companyModel.updateOne(
      { stripeSubscriptionId: subscription.id },
      { $set: { planEndsAtPeriodEnd: subscription.cancel_at_period_end } },
    );
  }

  private async endPlan(subscription: Stripe.Subscription) {
    if (subscription.metadata.app !== STRIPE_APP_TAG) return;

    await this.companyModel.updateOne(
      { stripeSubscriptionId: subscription.id },
      {
        $set: {
          plan: BillingPlan.PAY_AS_YOU_PUBLISH,
          credits: 0,
          planEndsAtPeriodEnd: false,
        },
        $unset: { stripeSubscriptionId: '', planRenewsAt: '' },
      },
    );
  }
}
