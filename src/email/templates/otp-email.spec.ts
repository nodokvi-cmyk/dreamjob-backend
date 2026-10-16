import { renderOtpEmail } from './otp-email.js';

describe('renderOtpEmail', () => {
  it('renders the code and expiry into html and plain text', async () => {
    const { subject, html, text } = await renderOtpEmail({
      code: '482913',
      expiresInMinutes: 10,
    });

    expect(subject).toBe('Your DreamJob verification code');
    expect(html).toContain('482913');
    expect(html).toContain('10 minutes');
    expect(text).toContain('482913');
    expect(text).not.toContain('<');
  });
});
