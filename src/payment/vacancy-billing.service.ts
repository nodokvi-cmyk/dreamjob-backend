import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import Stripe from 'stripe';
import { Company } from '../companies/schema/company.schema.js';
import { BillingPlan } from '../shared/types/billing-plan.js';
import {
  CreditSource,
  MS_PER_DAY,
  VACANCY_WINDOW_DAYS,
  Vacancy,
  VacancyRecord,
  VacancyStatus,
} from '../vacancies/schema/vacancy.schema.js';
import { vacancyViewStatus } from '../vacancies/vacancy-status.js';
import { claimPayment } from './claim-payment.js';
import { isPaidPlan, PLAN_SETTINGS, STRIPE_APP_TAG } from './plan-settings.js';
import {
  Payment,
  PaymentKind,
  VacancyPaymentPurpose,
} from './schema/payment.schema.js';
import { STRIPE_CLIENT } from './stripe-client.js';

export type VacancyBillingResult =
  | { kind: 'done'; vacancy: VacancyRecord }
  | { kind: 'checkout'; checkoutUrl: string };

const WINDOW_MS = VACANCY_WINDOW_DAYS * MS_PER_DAY;

@Injectable()
export class VacancyBillingService {
  private readonly logger = new Logger(VacancyBillingService.name);

  constructor(
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe,
    private readonly config: ConfigService,
    @InjectModel(Company.name)
    private readonly companyModel: Model<Company>,
    @InjectModel(Vacancy.name)
    private readonly vacancyModel: Model<Vacancy>,
    @InjectModel(Payment.name)
    private readonly paymentModel: Model<Payment>,
  ) {}

  async submit(
    vacancy: VacancyRecord,
    companyId: string,
  ): Promise<VacancyBillingResult> {
    if (vacancy.status !== VacancyStatus.PENDING || vacancy.submittedAt) {
      throw new BadRequestException('Vacancy is already submitted');
    }
    if (vacancy.deadline.getTime() <= Date.now()) {
      throw new BadRequestException(
        'The deadline has passed, change it before submitting',
      );
    }

    const source = await this.spendCredit(companyId);
    if (!source) {
      return {
        kind: 'checkout',
        checkoutUrl: await this.checkoutUrl(
          vacancy,
          companyId,
          VacancyPaymentPurpose.SUBMIT,
        ),
      };
    }

    const submitted = await this.vacancyModel
      .findOneAndUpdate(
        {
          _id: vacancy._id,
          company: companyId,
          status: VacancyStatus.PENDING,
          submittedAt: { $exists: false },
        },
        {
          $set: { submittedAt: new Date(), creditSource: source },
          $unset: { checkoutSessionId: 1 },
        },
        { returnDocument: 'after' },
      )
      .lean<VacancyRecord>();
    if (!submitted) {
      await this.giveBack(companyId, source);
      throw new ConflictException('Vacancy changed, try again');
    }

    await this.expireCheckoutQuietly(vacancy.checkoutSessionId);
    return { kind: 'done', vacancy: submitted };
  }

  async extend(
    vacancy: VacancyRecord,
    companyId: string,
    deadline: Date,
  ): Promise<VacancyBillingResult> {
    if (vacancy.status === VacancyStatus.CLOSED) {
      throw new BadRequestException('Closed vacancies cannot be extended');
    }
    if (!vacancy.firstPublishedAt || !vacancy.freeWindowEndsAt) {
      throw new BadRequestException(
        'Only vacancies that were published can be extended',
      );
    }

    const now = Date.now();
    if (deadline.getTime() <= Math.max(vacancy.deadline.getTime(), now)) {
      throw new BadRequestException(
        'The new deadline must be later than the current one',
      );
    }

    const currentEnd = this.effectiveWindowEnd(
      vacancy.freeWindowEndsAt,
      vacancy.windowPausedAt,
      now,
    );
    if (deadline.getTime() <= currentEnd.getTime()) {
      const extended = await this.saveExtension(vacancy, { deadline });
      await this.expireCheckoutQuietly(vacancy.checkoutSessionId);
      return { kind: 'done', vacancy: extended };
    }

    const windowEnd = this.paidWindowEnd(currentEnd, now);
    if (deadline.getTime() > windowEnd.getTime()) {
      throw new BadRequestException(
        `A paid extension can move the deadline to ${windowEnd.toISOString()} at most`,
      );
    }

    const source = await this.spendCredit(companyId);
    if (!source) {
      return {
        kind: 'checkout',
        checkoutUrl: await this.checkoutUrl(
          vacancy,
          companyId,
          VacancyPaymentPurpose.EXTEND,
          deadline,
        ),
      };
    }

    try {
      const extended = await this.saveExtension(vacancy, {
        deadline,
        freeWindowEndsAt: windowEnd,
      });
      await this.expireCheckoutQuietly(vacancy.checkoutSessionId);
      return { kind: 'done', vacancy: extended };
    } catch (error: unknown) {
      await this.giveBack(companyId, source);
      throw error;
    }
  }

  async fulfill(session: Stripe.Checkout.Session): Promise<void> {
    const metadata = session.metadata;
    if (!metadata) return;

    const { companyId, vacancyId, purpose, newDeadline } = metadata;
    if (!companyId || !Types.ObjectId.isValid(companyId)) return;
    if (!vacancyId || !Types.ObjectId.isValid(vacancyId)) return;
    if (
      purpose !== VacancyPaymentPurpose.SUBMIT &&
      purpose !== VacancyPaymentPurpose.EXTEND
    ) {
      return;
    }

    const deadline = newDeadline ? new Date(newDeadline) : undefined;
    if (
      purpose === VacancyPaymentPurpose.EXTEND &&
      (!deadline || Number.isNaN(deadline.getTime()))
    ) {
      return;
    }

    const claimed = await claimPayment(this.paymentModel, session.id, {
      company: new Types.ObjectId(companyId),
      kind: PaymentKind.VACANCY,
      vacancy: new Types.ObjectId(vacancyId),
      purpose,
      amount: session.amount_total ?? undefined,
    });
    if (!claimed) return;

    try {
      const applied =
        purpose === VacancyPaymentPurpose.SUBMIT || !deadline
          ? await this.applyPaidSubmit(vacancyId, companyId)
          : await this.applyPaidExtension(vacancyId, companyId, deadline);

      if (!applied) {
        await this.companyModel.updateOne(
          { _id: companyId },
          { $inc: { purchasedCredits: 1 } },
        );
      }
    } catch (error: unknown) {
      await this.paymentModel.deleteOne({ stripeSessionId: session.id });
      throw error;
    }
  }

  async describe(session: Stripe.Checkout.Session) {
    const vacancyId = session.metadata?.vacancyId;
    const vacancy =
      vacancyId && Types.ObjectId.isValid(vacancyId)
        ? await this.vacancyModel.findById(vacancyId).lean<VacancyRecord>()
        : null;

    return {
      vacancyId,
      purpose: session.metadata?.purpose,
      vacancyStatus: vacancy ? vacancyViewStatus(vacancy) : undefined,
      deadline: vacancy?.deadline,
    };
  }

  async refundCredit(
    companyId: string,
    source: CreditSource,
    session: ClientSession,
  ): Promise<void> {
    if (source === CreditSource.PURCHASED) {
      await this.companyModel.updateOne(
        { _id: companyId },
        { $inc: { purchasedCredits: 1 } },
        { session },
      );
      return;
    }

    const company = await this.companyModel
      .findById(companyId)
      .session(session);
    if (!company || !isPaidPlan(company.plan)) return;

    await this.companyModel.updateOne(
      {
        _id: companyId,
        credits: { $lt: PLAN_SETTINGS[company.plan].includedCredits },
      },
      { $inc: { credits: 1 } },
      { session },
    );
  }

  async expireCheckoutQuietly(sessionId: string | undefined): Promise<void> {
    if (!sessionId) return;

    try {
      await this.stripe.checkout.sessions.expire(sessionId);
    } catch (error: unknown) {
      this.logger.warn(
        error instanceof Error ? error.message : 'Could not expire checkout',
      );
    }
  }

  private async spendCredit(
    companyId: string,
  ): Promise<CreditSource | undefined> {
    const fromPlan = await this.companyModel.findOneAndUpdate(
      { _id: companyId, credits: { $gt: 0 } },
      { $inc: { credits: -1 } },
    );
    if (fromPlan) return CreditSource.PLAN;

    const fromPurchased = await this.companyModel.findOneAndUpdate(
      { _id: companyId, purchasedCredits: { $gt: 0 } },
      { $inc: { purchasedCredits: -1 } },
    );
    return fromPurchased ? CreditSource.PURCHASED : undefined;
  }

  private async giveBack(companyId: string, source: CreditSource) {
    try {
      await this.companyModel.updateOne(
        { _id: companyId },
        {
          $inc:
            source === CreditSource.PLAN
              ? { credits: 1 }
              : { purchasedCredits: 1 },
        },
      );
    } catch (error: unknown) {
      this.logger.error(
        `Could not give a ${source} credit back to company ${companyId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private paidWindowEnd(currentEnd: Date, now: number): Date {
    return new Date(Math.max(currentEnd.getTime(), now) + WINDOW_MS);
  }

  private effectiveWindowEnd(
    windowEnd: Date,
    pausedAt: Date | undefined,
    now: number,
  ): Date {
    if (!pausedAt) return windowEnd;

    return new Date(
      windowEnd.getTime() + Math.max(now - pausedAt.getTime(), 0),
    );
  }

  private async saveExtension(
    vacancy: VacancyRecord,
    changes: { deadline: Date; freeWindowEndsAt?: Date },
  ): Promise<VacancyRecord> {
    const set =
      vacancy.windowPausedAt && changes.freeWindowEndsAt
        ? { ...changes, windowPausedAt: new Date() }
        : changes;
    const updated = await this.vacancyModel
      .findOneAndUpdate(
        { _id: vacancy._id, updatedAt: vacancy.updatedAt },
        { $set: set, $unset: { checkoutSessionId: 1 } },
        { returnDocument: 'after' },
      )
      .lean<VacancyRecord>();
    if (!updated) throw new ConflictException('Vacancy changed, try again');

    return updated;
  }

  private async applyPaidSubmit(
    vacancyId: string,
    companyId: string,
  ): Promise<boolean> {
    const submitted = await this.vacancyModel.findOneAndUpdate(
      {
        _id: vacancyId,
        company: companyId,
        status: VacancyStatus.PENDING,
        submittedAt: { $exists: false },
      },
      {
        $set: {
          submittedAt: new Date(),
          creditSource: CreditSource.PURCHASED,
        },
        $unset: { checkoutSessionId: 1 },
      },
    );

    return submitted !== null;
  }

  private async applyPaidExtension(
    vacancyId: string,
    companyId: string,
    deadline: Date,
  ): Promise<boolean> {
    const vacancy = await this.vacancyModel
      .findOne({ _id: vacancyId, company: companyId })
      .lean<VacancyRecord>();
    if (
      !vacancy ||
      vacancy.status === VacancyStatus.CLOSED ||
      !vacancy.firstPublishedAt ||
      !vacancy.freeWindowEndsAt
    ) {
      return false;
    }

    const now = Date.now();
    const windowEnd = this.paidWindowEnd(
      this.effectiveWindowEnd(
        vacancy.freeWindowEndsAt,
        vacancy.windowPausedAt,
        now,
      ),
      now,
    );
    if (
      deadline.getTime() <= Math.max(vacancy.deadline.getTime(), now) ||
      deadline.getTime() > windowEnd.getTime()
    ) {
      return false;
    }

    await this.saveExtension(vacancy, {
      deadline,
      freeWindowEndsAt: windowEnd,
    });
    return true;
  }

  private async checkoutUrl(
    vacancy: VacancyRecord,
    companyId: string,
    purpose: VacancyPaymentPurpose,
    newDeadline?: Date,
  ): Promise<string> {
    const company = await this.companyModel
      .findById(companyId)
      .select('+stripeCustomerId');
    if (!company) throw new NotFoundException('Company not found');

    const amount =
      PLAN_SETTINGS[company.plan ?? BillingPlan.PAY_AS_YOU_PUBLISH]
        .vacancyPriceCents;
    const deadlineValue = newDeadline?.toISOString() ?? '';

    const reusable = await this.reusableSessionUrl(
      vacancy.checkoutSessionId,
      purpose,
      deadlineValue,
      amount,
    );
    if (reusable) return reusable;

    const frontend = this.config.getOrThrow<string>('FRONTEND_URI');
    const metadata: Record<string, string> = {
      app: STRIPE_APP_TAG,
      kind: PaymentKind.VACANCY,
      companyId,
      vacancyId: vacancy._id.toString(),
      purpose,
    };
    if (deadlineValue) metadata.newDeadline = deadlineValue;

    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      client_reference_id: companyId,
      ...(company.stripeCustomerId
        ? { customer: company.stripeCustomerId }
        : { customer_email: company.email }),
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: amount,
            product_data: {
              name:
                purpose === VacancyPaymentPurpose.SUBMIT
                  ? 'GetDreamJob vacancy publication'
                  : `GetDreamJob vacancy extension (${VACANCY_WINDOW_DAYS} days)`,
            },
          },
        },
      ],
      metadata,
      success_url: `${frontend}/company/vacancies?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontend}/company/vacancies?payment=cancelled`,
    });
    if (!session.url) {
      await this.expireCheckoutQuietly(session.id);
      throw new InternalServerErrorException('Could not start checkout');
    }

    const stored = await this.vacancyModel.findOneAndUpdate(
      {
        _id: vacancy._id,
        checkoutSessionId: vacancy.checkoutSessionId ?? { $exists: false },
      },
      { $set: { checkoutSessionId: session.id } },
    );
    if (!stored) {
      await this.expireCheckoutQuietly(session.id);
      throw new ConflictException(
        'Another payment was just started, try again',
      );
    }

    return session.url;
  }

  private async reusableSessionUrl(
    sessionId: string | undefined,
    purpose: VacancyPaymentPurpose,
    deadlineValue: string,
    amount: number,
  ): Promise<string | undefined> {
    if (!sessionId) return undefined;

    let session: Stripe.Checkout.Session;
    try {
      session = await this.stripe.checkout.sessions.retrieve(sessionId);
    } catch (error: unknown) {
      this.logger.warn(
        error instanceof Error ? error.message : 'Session lookup failed',
      );
      return undefined;
    }
    if (session.status !== 'open') return undefined;

    const matches =
      session.metadata?.purpose === purpose &&
      (session.metadata?.newDeadline ?? '') === deadlineValue &&
      session.amount_total === amount;
    if (matches && session.url) return session.url;

    await this.expireCheckoutQuietly(sessionId);
    return undefined;
  }
}
