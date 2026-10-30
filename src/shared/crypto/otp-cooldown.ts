import { HttpException, HttpStatus } from '@nestjs/common';
import type { OtpHolder } from './otp-hash.js';

export const OTP_EXPIRATION_MINUTES = 10;
export const OTP_RESEND_COOLDOWN_SECONDS = 60;

export const otpCooldownSecondsLeft = ({
  OTPCodeExpirationDate,
}: Pick<OtpHolder, 'OTPCodeExpirationDate'>): number => {
  if (!OTPCodeExpirationDate) return 0;

  const sentAt =
    OTPCodeExpirationDate.getTime() - OTP_EXPIRATION_MINUTES * 60_000;
  const readyAt = sentAt + OTP_RESEND_COOLDOWN_SECONDS * 1000;

  return Math.max(0, Math.ceil((readyAt - Date.now()) / 1000));
};

export const otpCooldownError = (secondsLeft: number): HttpException =>
  new HttpException(
    `Wait ${secondsLeft} seconds before requesting another code`,
    HttpStatus.TOO_MANY_REQUESTS,
  );
