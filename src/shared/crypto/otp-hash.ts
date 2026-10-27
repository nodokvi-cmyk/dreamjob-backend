import { createHmac, timingSafeEqual } from 'node:crypto';
import type { OtpPurpose } from '../types/otp-purpose.js';

export interface OtpHolder {
  OTPCode?: string;
  OTPCodeExpirationDate?: Date;
  OTPPurpose?: OtpPurpose;
}

export const hashOtp = (code: string, secret: string): string =>
  createHmac('sha256', secret).update(code).digest('hex');

export const isOtpMatch = (
  code: string,
  storedHash: string,
  secret: string,
): boolean => {
  const candidate = Buffer.from(hashOtp(code, secret), 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  return (
    candidate.length === stored.length && timingSafeEqual(candidate, stored)
  );
};

export const isOtpValid = (
  { OTPCode, OTPCodeExpirationDate, OTPPurpose }: OtpHolder,
  code: string,
  purpose: OtpPurpose,
  secret: string,
): boolean =>
  !!OTPCode &&
  !!OTPCodeExpirationDate &&
  OTPPurpose === purpose &&
  OTPCodeExpirationDate.getTime() > Date.now() &&
  isOtpMatch(code, OTPCode, secret);
