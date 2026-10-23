import { hashOtp, isOtpMatch } from './otp-hash.js';

describe('otp-hash', () => {
  it('produces a stable hex digest that is not the code itself', () => {
    const hash = hashOtp('482913', 'secret');

    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain('482913');
    expect(hashOtp('482913', 'secret')).toBe(hash);
  });

  it('changes the digest when the secret changes', () => {
    expect(hashOtp('482913', 'one')).not.toBe(hashOtp('482913', 'two'));
  });

  it('matches only the same code', () => {
    const stored = hashOtp('482913', 'secret');

    expect(isOtpMatch('482913', stored, 'secret')).toBe(true);
    expect(isOtpMatch('482914', stored, 'secret')).toBe(false);
  });

  it('rejects a stored value that is not a valid digest', () => {
    expect(isOtpMatch('482913', 'not-a-digest', 'secret')).toBe(false);
  });
});
