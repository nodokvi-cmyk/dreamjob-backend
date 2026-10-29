import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt } from 'node:crypto';
import { renderOtpEmail } from '../email/templates/otp-email.js';
import type { OtpEmailVariant } from '../email/templates/otp-email.js';
import { MAIL_TRANSPORT } from './mail-transport.provider.js';
import type { MailTransport } from './mail-transport.provider.js';

const OTP_EXPIRATION_MINUTES = 10;

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
    return this.sendCode(to, code, 'verification');
  }

  sendPasswordResetCode(to: string, code: string): Promise<void> {
    return this.sendCode(to, code, 'passwordReset');
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
        from: `DreamJob <${this.config.getOrThrow<string>('EMAIL_USER')}>`,
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
