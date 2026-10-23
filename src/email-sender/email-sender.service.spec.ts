import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hashOtp } from '../shared/crypto/otp-hash.js';
import { OtpPurpose } from '../users/schema/user.schema.js';
import { EmailSenderService } from './email-sender.service.js';

const createService = (
  options: { sendMailError?: Error; user?: unknown } = {},
) => {
  const sendMail = vi.fn();
  if (options.sendMailError) sendMail.mockRejectedValue(options.sendMailError);
  const findByEmail = vi.fn().mockResolvedValue(options.user ?? null);
  const setVerificationCode = vi.fn().mockResolvedValue(undefined);
  const config = new ConfigService({
    EMAIL_USER: 'sender@example.com',
    OTP_SECRET: 'otp-secret',
  });
  const service = new EmailSenderService({ sendMail }, config, {
    findByEmail,
    setVerificationCode,
  });
  return { service, sendMail, findByEmail, setVerificationCode };
};

describe('EmailSenderService', () => {
  describe('createVerificationCode', () => {
    it('returns a 6-digit code that expires in about 10 minutes', () => {
      const { service } = createService();
      const before = Date.now();

      const { code, expiresAt } = service.createVerificationCode();

      expect(code).toMatch(/^\d{6}$/);
      expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + 600_000);
      expect(expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 600_000);
    });
  });

  describe('sendVerificationCode', () => {
    it('sends the rendered code to the recipient', async () => {
      const { service, sendMail } = createService();

      await service.sendVerificationCode('user@example.com', '482913');

      expect(sendMail).toHaveBeenCalledTimes(1);
      const message = sendMail.mock.calls[0]?.[0];
      expect(message.to).toBe('user@example.com');
      expect(message.from).toBe('DreamJob <sender@example.com>');
      expect(message.subject).toBe('Your DreamJob verification code');
      expect(message.html).toContain('482913');
      expect(message.text).toContain('482913');
    });

    it('hides the SMTP error from the caller', async () => {
      const { service } = createService({
        sendMailError: new Error('535 bad login'),
      });

      const result = service.sendVerificationCode('user@example.com', '482913');

      await expect(result).rejects.toBeInstanceOf(ServiceUnavailableException);
      await expect(result).rejects.toThrow(
        'Failed to send the verification email',
      );
      await expect(result).rejects.not.toThrow('535');
    });
  });

  describe('resendVerificationCode', () => {
    it('stores a hashed code and emails the plain code to an unverified user', async () => {
      const { service, sendMail, setVerificationCode } = createService({
        user: { isVerified: false },
      });

      await service.resendVerificationCode('user@example.com');

      expect(setVerificationCode).toHaveBeenCalledTimes(1);
      const [email, storedHash, expiresAt, purpose] =
        setVerificationCode.mock.calls[0] ?? [];
      expect(email).toBe('user@example.com');
      expect(purpose).toBe(OtpPurpose.EMAIL_VERIFICATION);
      expect(expiresAt).toBeInstanceOf(Date);

      const message = sendMail.mock.calls[0]?.[0];
      const sentCode = /\d{6}/.exec(message.text)?.[0];
      expect(sentCode).toBeDefined();
      expect(storedHash).toBe(hashOtp(sentCode ?? '', 'otp-secret'));
      expect(storedHash).not.toContain(sentCode);
    });

    it('does nothing when the user does not exist', async () => {
      const { service, sendMail, setVerificationCode } = createService();

      await service.resendVerificationCode('nobody@example.com');

      expect(setVerificationCode).not.toHaveBeenCalled();
      expect(sendMail).not.toHaveBeenCalled();
    });

    it('does nothing when the user is already verified', async () => {
      const { service, sendMail, setVerificationCode } = createService({
        user: { isVerified: true },
      });

      await service.resendVerificationCode('user@example.com');

      expect(setVerificationCode).not.toHaveBeenCalled();
      expect(sendMail).not.toHaveBeenCalled();
    });
  });
});
