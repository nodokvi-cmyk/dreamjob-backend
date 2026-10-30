export const OTP_MAX_ATTEMPTS = 5;

export const otpAttemptsLeftFilter = {
  OTPAttempts: { $not: { $gte: OTP_MAX_ATTEMPTS } },
};
