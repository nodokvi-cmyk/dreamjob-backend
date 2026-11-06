import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt } from 'node:crypto';
import {
  OtpEmailVariant,
  renderOtpEmail,
} from '../email/templates/otp-email.js';
import {
  PlanNoticeEmailProps,
  renderPlanNoticeEmail,
} from '../email/templates/plan-notice-email.js';
import { OTP_EXPIRATION_MINUTES } from '../shared/crypto/otp-cooldown.js';
import { MAIL_TRANSPORT } from './mail-transport.provider.js';
import type { MailTransport } from './mail-transport.provider.js';

@Injectable()
export class EmailSenderService {
  private readonly logger = new Logger(EmailSenderService.name);

  constructor(
    @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport,
    private readonly config: ConfigService,
  ) {}

  createVerificationCode(): { code: string; expiresAt: Date } {
    return {
      code: randomInt(0, 1_000_000).toString().padStart(6, '0'),
      expiresAt: new Date(Date.now() + OTP_EXPIRATION_MINUTES * 60_000),
    };
  }

  sendVerificationCode(to: string, code: string): Promise<void> {
    return this.sendCode(to, code, OtpEmailVariant.VERIFICATION);
  }

  sendPasswordResetCode(to: string, code: string): Promise<void> {
    return this.sendCode(to, code, OtpEmailVariant.PASSWORD_RESET);
  }

  sendPlanEndedNotice(to: string, planName: string): Promise<void> {
    const billingUrl = `${this.config.getOrThrow<string>('FRONTEND_URI')}/company/billing`;

    return this.sendNotice(to, {
      subject: 'Your GetDreamJob plan has ended',
      heading: 'Your plan has ended',
      paragraphs: [
        `We could not collect the payment for your ${planName} plan, so the plan has ended and no further payment attempts will be made.`,
        'You can still publish vacancies and pay for each one. To get a plan again, subscribe from your billing page.',
      ],
      buttonLabel: 'Go to billing',
      buttonUrl: billingUrl,
    });
  }

  sendPaymentActionNotice(
    to: string,
    planName: string,
    confirmUrl: string,
    waitDays: number,
  ): Promise<void> {
    return this.sendNotice(to, {
      subject: 'Confirm your GetDreamJob payment',
      heading: 'Your bank needs a confirmation',
      paragraphs: [
        `Your bank asked you to confirm the renewal payment for your ${planName} plan.`,
        `Please confirm it within ${waitDays} days to keep your plan. If it is not confirmed in time, the plan will end.`,
      ],
      buttonLabel: 'Confirm payment',
      buttonUrl: confirmUrl,
    });
  }

  private async sendNotice(
    to: string,
    props: PlanNoticeEmailProps,
  ): Promise<void> {
    const { subject, html, text } = await renderPlanNoticeEmail(props);

    try {
      await this.transport.sendMail({
        from: `GetDreamJob <${this.config.getOrThrow<string>('EMAIL_USER')}>`,
        to,
        subject,
        html,
        text,
      });
    } catch (error: unknown) {
      this.logger.error(
        'Failed to send plan notice email',
        error instanceof Error ? error.stack : String(error),
      );
      throw new ServiceUnavailableException('Failed to send the email');
    }
  }

  private async sendCode(
    to: string,
    code: string,
    variant: OtpEmailVariant,
  ): Promise<void> {
    const { subject, html, text } = await renderOtpEmail({
      code,
      expiresInMinutes: OTP_EXPIRATION_MINUTES,
      variant,
    });

    try {
      await this.transport.sendMail({
        from: `GetDreamJob <${this.config.getOrThrow<string>('EMAIL_USER')}>`,
        to,
        subject,
        html,
        text,
      });
    } catch (error: unknown) {
      this.logger.error(
        'Failed to send verification email',
        error instanceof Error ? error.stack : String(error),
      );
      throw new ServiceUnavailableException(
        'Failed to send the verification email',
      );
    }
  }
}
