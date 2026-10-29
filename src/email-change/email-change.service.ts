import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CompaniesService } from '../companies/companies.service.js';
import { EmailClaimsService } from '../email-claims/email-claims.service.js';
import { EmailSenderService } from '../email-sender/email-sender.service.js';
import { hashOtp, isOtpValid } from '../shared/crypto/otp-hash.js';
import { withEmailConflict } from '../shared/mongo/with-email-conflict.js';
import type {
  EmailChangeAccount,
  EmailChangeStore,
} from '../shared/types/email-change-store.js';
import { OtpPurpose } from '../shared/types/otp-purpose.js';
import { UsersService } from '../users/users.service.js';
import { ChangeEmailDto } from './dto/change-email.dto.js';
import { CodeDto } from '../shared/dto/code.dto.js';

@Injectable()
export class EmailChangeService {
  constructor(
    private readonly usersService: UsersService,
    private readonly companiesService: CompaniesService,
    private readonly emailClaims: EmailClaimsService,
    private readonly emailSender: EmailSenderService,
    private readonly config: ConfigService,
  ) {}

  requestUserEmailChange(
    accountId: string,
    { newEmail }: ChangeEmailDto,
  ): Promise<{ message: string }> {
    return this.requestEmailChange(this.usersService, accountId, newEmail);
  }

  confirmUserCurrentEmail(
    accountId: string,
    { code }: CodeDto,
  ): Promise<{ message: string }> {
    return this.confirmCurrentEmail(this.usersService, accountId, code);
  }

  confirmUserNewEmail(
    accountId: string,
    { code }: CodeDto,
  ): Promise<{ message: string }> {
    return this.confirmNewEmail(this.usersService, accountId, code);
  }

  resendUserNewEmailCode(accountId: string): Promise<{ message: string }> {
    return this.resendNewEmailCode(this.usersService, accountId);
  }

  resendCompanyNewEmailCode(accountId: string): Promise<{ message: string }> {
    return this.resendNewEmailCode(this.companiesService, accountId);
  }

  requestCompanyEmailChange(
    accountId: string,
    { newEmail }: ChangeEmailDto,
  ): Promise<{ message: string }> {
    return this.requestEmailChange(this.companiesService, accountId, newEmail);
  }

  confirmCompanyCurrentEmail(
    accountId: string,
    { code }: CodeDto,
  ): Promise<{ message: string }> {
    return this.confirmCurrentEmail(this.companiesService, accountId, code);
  }

  confirmCompanyNewEmail(
    accountId: string,
    { code }: CodeDto,
  ): Promise<{ message: string }> {
    return this.confirmNewEmail(this.companiesService, accountId, code);
  }

  private async requestEmailChange(
    store: EmailChangeStore,
    accountId: string,
    newEmail: string,
  ): Promise<{ message: string }> {
    const account = await this.findEmailChangeAccount(store, accountId);

    if (newEmail === account.email) {
      throw new BadRequestException(
        'New email must be different from the current email',
      );
    }
    await this.assertEmailAvailable(newEmail);

    const { code, expiresAt } = this.emailSender.createVerificationCode();
    await this.emailSender.sendVerificationCode(account.email, code);
    await store.startEmailChange(
      accountId,
      newEmail,
      hashOtp(code, this.otpSecret()),
      expiresAt,
    );

    return { message: 'Verification code sent to your current email' };
  }

  private async confirmCurrentEmail(
    store: EmailChangeStore,
    accountId: string,
    code: string,
  ): Promise<{ message: string }> {
    const account = await this.findEmailChangeAccount(store, accountId);
    const pendingEmail = this.getPendingEmail(
      account,
      code,
      OtpPurpose.CURRENT_EMAIL_CHANGE,
    );
    await this.assertEmailAvailable(pendingEmail);

    return this.sendNewEmailCode(store, accountId, pendingEmail);
  }

  private async resendNewEmailCode(
    store: EmailChangeStore,
    accountId: string,
  ): Promise<{ message: string }> {
    const { pendingEmail, isVerified, OTPPurpose } =
      await this.findEmailChangeAccount(store, accountId);

    if (
      !pendingEmail ||
      !isVerified ||
      OTPPurpose !== OtpPurpose.NEW_EMAIL_CHANGE
    ) {
      throw new BadRequestException('No email change is waiting for a code');
    }
    await this.assertEmailAvailable(pendingEmail);

    return this.sendNewEmailCode(store, accountId, pendingEmail);
  }

  private async sendNewEmailCode(
    store: EmailChangeStore,
    accountId: string,
    pendingEmail: string,
  ): Promise<{ message: string }> {
    const { code, expiresAt } = this.emailSender.createVerificationCode();
    await this.emailSender.sendVerificationCode(pendingEmail, code);
    await store.setEmailChangeCode(
      accountId,
      hashOtp(code, this.otpSecret()),
      expiresAt,
      OtpPurpose.NEW_EMAIL_CHANGE,
    );

    return { message: 'Verification code sent to your new email' };
  }

  private async confirmNewEmail(
    store: EmailChangeStore,
    accountId: string,
    code: string,
  ): Promise<{ message: string }> {
    const account = await this.findEmailChangeAccount(store, accountId);
    const pendingEmail = this.getPendingEmail(
      account,
      code,
      OtpPurpose.NEW_EMAIL_CHANGE,
    );

    await this.emailClaims.claim(pendingEmail, accountId);
    try {
      await withEmailConflict(() =>
        store.completeEmailChange(accountId, pendingEmail),
      );
    } catch (error: unknown) {
      await this.emailClaims.release(pendingEmail, accountId);
      throw error;
    }
    await this.emailClaims.confirm(pendingEmail, accountId);
    await this.emailClaims.release(account.email, accountId);

    return { message: 'Email updated' };
  }

  private async findEmailChangeAccount(
    store: EmailChangeStore,
    accountId: string,
  ): Promise<EmailChangeAccount> {
    const account = await store.findForEmailChange(accountId);
    if (!account) throw new NotFoundException('Account not found');

    return account;
  }

  private getPendingEmail(
    account: EmailChangeAccount,
    code: string,
    purpose: OtpPurpose,
  ): string {
    const { pendingEmail } = account;

    if (
      !pendingEmail ||
      !account.isVerified ||
      !isOtpValid(account, code, purpose, this.otpSecret())
    ) {
      throw new UnauthorizedException('Invalid or expired verification code');
    }

    return pendingEmail;
  }

  private async assertEmailAvailable(email: string): Promise<void> {
    if (await this.emailClaims.isTaken(email)) {
      throw new ConflictException('Email is already in use');
    }
  }

  private otpSecret(): string {
    return this.config.getOrThrow<string>('OTP_SECRET');
  }
}
