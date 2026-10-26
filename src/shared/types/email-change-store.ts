import type { OtpPurpose } from './otp-purpose.js';

export interface EmailChangeAccount {
  email: string;
  isVerified: boolean;
  pendingEmail?: string;
  OTPCode?: string;
  OTPCodeExpirationDate?: Date;
  OTPPurpose?: OtpPurpose;
}

export interface EmailChangeStore {
  findForEmailChange(accountId: string): Promise<EmailChangeAccount | null>;
  startEmailChange(
    accountId: string,
    pendingEmail: string,
    otpHash: string,
    expiresAt: Date,
  ): Promise<void>;
  setEmailChangeCode(
    accountId: string,
    otpHash: string,
    expiresAt: Date,
    purpose: OtpPurpose,
  ): Promise<void>;
  completeEmailChange(accountId: string, email: string): Promise<void>;
}
