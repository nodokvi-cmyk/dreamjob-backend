import { createHmac, timingSafeEqual } from 'node:crypto';

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
