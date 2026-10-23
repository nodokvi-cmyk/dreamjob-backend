import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt } from 'node:crypto';
import { renderOtpEmail } from '../email/templates/otp-email.js';
import { hashOtp } from '../shared/crypto/otp-hash.js';
import { OtpPurpose } from '../users/schema/user.schema.js';
import { UsersService } from '../users/users.service.js';
import { MAIL_TRANSPORT } from './mail-transport.provider.js';
import type { MailTransport } from './mail-transport.provider.js';

const OTP_EXPIRATION_MINUTES = 10;

@Injectable()
export class EmailSenderService {
  private readonly logger = new Logger(EmailSenderService.name);

  constructor(
    @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport,
    private readonly config: ConfigService,
    @Inject(UsersService)
    private readonly users: Pick<
      UsersService,
      'findByEmail' | 'setVerificationCode'
    >,
  ) {}

  createVerificationCode(): { code: string; expiresAt: Date } {
    return {
      code: randomInt(0, 1_000_000).toString().padStart(6, '0'),
      expiresAt: new Date(Date.now() + OTP_EXPIRATION_MINUTES * 60_000),
    };
  }

  async sendVerificationCode(to: string, code: string): Promise<void> {
    const { subject, html, text } = await renderOtpEmail({
      code,
      expiresInMinutes: OTP_EXPIRATION_MINUTES,
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

  async resendVerificationCode(email: string): Promise<void> {
    const user = await this.users.findByEmail(email);
    if (!user || user.isVerified) return;

    const { code, expiresAt } = this.createVerificationCode();
    const otpHash = hashOtp(code, this.config.getOrThrow<string>('OTP_SECRET'));

    await this.users.setVerificationCode(
      email,
      otpHash,
      expiresAt,
      OtpPurpose.EMAIL_VERIFICATION,
    );
    await this.sendVerificationCode(email, code);
  }
}
