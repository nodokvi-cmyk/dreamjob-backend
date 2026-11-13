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
import { Company } from '../companies/schema/company.schema.js';
import { EmailSenderService } from '../email-sender/email-sender.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { NotificationType } from '../notifications/schema/notification.schema.js';
import { AuthRole } from '../shared/types/auth-role.js';
import { BillingPlan } from '../shared/types/billing-plan.js';
import { claimPayment } from './claim-payment.js';
import {
  AUTHENTICATION_WAIT_DAYS,
  isPaidPlan,
  PaidPlan,
  PLAN_END_AUTHENTICATION,
  PLAN_END_REASON_KEY,
  PLAN_SETTINGS,
  STRIPE_APP_TAG,
} from './plan-settings.js';
import { Payment, PaymentKind } from './schema/payment.schema.js';
import { STRIPE_CLIENT } from './stripe-client.js';
import { ensureStripeCustomer } from './stripe-customer.js';
import { VacancyBillingService } from './vacancy-billing.service.js';

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
    private readonly emailSender: EmailSenderService,
    private readonly vacancyBilling: VacancyBillingService,
    private readonly notifications: NotificationsService,
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

    const customerId = await ensureStripeCustomer(
      this.stripe,
      this.companyModel,
      company,
    );
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

    if (session.metadata.kind === PaymentKind.VACANCY) {
      return {
        kind: PaymentKind.VACANCY,
        paid: session.payment_status === 'paid',
        ...(await this.vacancyBilling.describe(session)),
        credits: company.credits,
        purchasedCredits: company.purchasedCredits,
      };
    }

    return {
      kind: PaymentKind.SUBSCRIPTION,
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
      case 'invoice.payment_action_required':
        await this.waitForAuthentication(event.data.object);
        break;
      case 'invoice.payment_failed':
        await this.endPlanAfterFailedPayment(event.data.object);
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

  private async fulfillSession(session: Stripe.Checkout.Session) {
    if (session.metadata?.app !== STRIPE_APP_TAG) return;
    if (session.payment_status !== 'paid') return;

    if (session.metadata.kind === PaymentKind.VACANCY) {
      await this.vacancyBilling.fulfill(session);
      return;
    }

    const { companyId, plan } = session.metadata;
    if (!companyId || !Types.ObjectId.isValid(companyId)) return;
    if (plan !== BillingPlan.PLUS && plan !== BillingPlan.ELITE) return;

    const subscriptionId = idOf(session.subscription);
    if (!subscriptionId) return;

    const claimed = await claimPayment(this.paymentModel, session.id, {
      company: new Types.ObjectId(companyId),
      kind: PaymentKind.SUBSCRIPTION,
      plan,
      amount: session.amount_total ?? undefined,
    });
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

    const subscription =
      await this.stripe.subscriptions.retrieve(subscriptionId);
    if (
      subscription.metadata[PLAN_END_REASON_KEY] === PLAN_END_AUTHENTICATION
    ) {
      await this.stripe.subscriptions.update(subscriptionId, {
        cancel_at: '',
        metadata: { [PLAN_END_REASON_KEY]: '' },
      });
    }
  }

  private async markPlanEnding(subscription: Stripe.Subscription) {
    if (subscription.metadata.app !== STRIPE_APP_TAG) return;

    await this.companyModel.updateOne(
      { stripeSubscriptionId: subscription.id },
      { $set: { planEndsAtPeriodEnd: subscription.cancel_at_period_end } },
    );
  }

  private async findRenewalTarget(invoice: Stripe.Invoice) {
    if (invoice.billing_reason !== 'subscription_cycle') return undefined;

    const details = invoice.parent?.subscription_details;
    if (details?.metadata?.app !== STRIPE_APP_TAG) return undefined;

    const subscriptionId = idOf(details.subscription);
    if (!subscriptionId) return undefined;

    const company = await this.companyModel.findOne({
      stripeSubscriptionId: subscriptionId,
    });
    if (!company || !isPaidPlan(company.plan)) return undefined;

    return { subscriptionId, company, plan: company.plan };
  }

  private async needsAuthentication(invoice: Stripe.Invoice) {
    if (!invoice.id) return false;

    const payments = await this.stripe.invoicePayments.list({
      invoice: invoice.id,
    });
    for (const item of payments.data) {
      const intentId = idOf(item.payment.payment_intent);
      if (!intentId) continue;

      const intent = await this.stripe.paymentIntents.retrieve(intentId);
      if (intent.status === 'requires_action') return true;
    }

    return false;
  }

  private async waitForAuthentication(invoice: Stripe.Invoice) {
    const target = await this.findRenewalTarget(invoice);
    if (!target) return;

    const { subscriptionId, company, plan } = target;
    const subscription =
      await this.stripe.subscriptions.retrieve(subscriptionId);
    if (
      subscription.metadata[PLAN_END_REASON_KEY] === PLAN_END_AUTHENTICATION
    ) {
      return;
    }

    const cancelAt =
      Math.floor(Date.now() / 1000) + AUTHENTICATION_WAIT_DAYS * 86_400;
    await this.stripe.subscriptions.update(subscriptionId, {
      cancel_at: cancelAt,
      metadata: { [PLAN_END_REASON_KEY]: PLAN_END_AUTHENTICATION },
    });

    await this.notifications.notify(company.id, AuthRole.COMPANY, {
      type: NotificationType.PLAN_PAYMENT_ACTION_REQUIRED,
      data: { planName: PLAN_SETTINGS[plan].label },
    });

    if (!invoice.hosted_invoice_url) return;

    try {
      await this.emailSender.sendPaymentActionNotice(
        company.email,
        PLAN_SETTINGS[plan].label,
        invoice.hosted_invoice_url,
        AUTHENTICATION_WAIT_DAYS,
      );
    } catch (error: unknown) {
      this.logger.error(
        'Payment confirmation email was not sent',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  async deleteCustomer(customerId: string | undefined): Promise<void> {
    if (!customerId) return;

    try {
      await this.stripe.customers.del(customerId);
    } catch (error: unknown) {
      if (
        error instanceof Stripe.errors.StripeError &&
        error.code === 'resource_missing'
      ) {
        return;
      }
      this.logger.error(
        'Stripe customer was not deleted',
        error instanceof Error ? error.stack : String(error),
      );
      throw new InternalServerErrorException(
        'Could not close the billing account, try again',
      );
    }
  }

  private async endPlanAfterFailedPayment(invoice: Stripe.Invoice) {
    const target = await this.findRenewalTarget(invoice);
    if (!target) return;
    if (await this.needsAuthentication(invoice)) return;

    const { subscriptionId, company, plan } = target;

    try {
      await this.stripe.subscriptions.cancel(subscriptionId);
    } catch (error: unknown) {
      if (
        error instanceof Stripe.errors.StripeError &&
        error.code === 'resource_missing'
      ) {
        return;
      }
      throw error;
    }

    await this.voidInvoiceQuietly(invoice.id);
    const previous = await this.resetToFreePlan(subscriptionId);
    if (previous) await this.notifyPlanEnded(previous._id.toString(), plan);
    await this.sendPlanEndedQuietly(company.email, plan);
  }

  private async endPlan(subscription: Stripe.Subscription) {
    if (subscription.metadata.app !== STRIPE_APP_TAG) return;

    const previous = await this.resetToFreePlan(subscription.id);
    if (previous && isPaidPlan(previous.plan)) {
      await this.notifyPlanEnded(previous._id.toString(), previous.plan);
    }
    if (
      subscription.metadata[PLAN_END_REASON_KEY] !== PLAN_END_AUTHENTICATION
    ) {
      return;
    }

    await this.voidInvoiceQuietly(idOf(subscription.latest_invoice));
    if (previous && isPaidPlan(previous.plan)) {
      await this.sendPlanEndedQuietly(previous.email, previous.plan);
    }
  }

  private async voidInvoiceQuietly(invoiceId: string | undefined) {
    if (!invoiceId) return;

    try {
      await this.stripe.invoices.voidInvoice(invoiceId);
    } catch (error: unknown) {
      this.logger.warn(
        error instanceof Error ? error.message : 'Could not void invoice',
      );
    }
  }

  private notifyPlanEnded(companyId: string, plan: PaidPlan) {
    return this.notifications.notify(companyId, AuthRole.COMPANY, {
      type: NotificationType.PLAN_ENDED,
      data: { planName: PLAN_SETTINGS[plan].label },
    });
  }

  private async sendPlanEndedQuietly(email: string, plan: PaidPlan) {
    try {
      await this.emailSender.sendPlanEndedNotice(
        email,
        PLAN_SETTINGS[plan].label,
      );
    } catch (error: unknown) {
      this.logger.error(
        'Plan ended email was not sent',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private resetToFreePlan(subscriptionId: string) {
    return this.companyModel.findOneAndUpdate(
      { stripeSubscriptionId: subscriptionId },
      {
        $set: {
          plan: BillingPlan.PAY_AS_YOU_PUBLISH,
          credits: 0,
          planEndsAtPeriodEnd: false,
        },
        $unset: { stripeSubscriptionId: '', planRenewsAt: '' },
      },
      { new: false },
    );
  }
}
