import { MailService } from './mail.service';

describe('MailService', () => {
  const previous = {
    EMAIL_PROVIDER: process.env.EMAIL_PROVIDER,
    MAIL_FROM: process.env.MAIL_FROM,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    SMTP_HOST: process.env.SMTP_HOST,
  };

  beforeAll(() => {
    process.env.EMAIL_PROVIDER = 'log';
    process.env.MAIL_FROM = 'AUTHENTIC <test@localhost>';
    delete process.env.RESEND_API_KEY;
    delete process.env.SMTP_HOST;
  });

  afterAll(() => {
    restore('EMAIL_PROVIDER', previous.EMAIL_PROVIDER);
    restore('MAIL_FROM', previous.MAIL_FROM);
    restore('RESEND_API_KEY', previous.RESEND_API_KEY);
    restore('SMTP_HOST', previous.SMTP_HOST);
  });

  it('renders HTML templates through the layout', () => {
    const mail = new MailService();
    const html = mail.render('reset-password', {
      firstName: 'Ada',
      code: '482910',
      resetUrl: 'https://app.example/reset-password?token=abc',
      token: 'abc',
      subject: 'Reset your AUTHENTIC password',
      year: 2026,
    });
    expect(html).toContain('Reset your password');
    expect(html).toContain('482910');
    expect(html).toContain('https://app.example/reset-password?token=abc');
    expect(html).toContain('AUTHENTIC');
  });

  it('logs instead of sending when EMAIL_PROVIDER=log', async () => {
    const mail = new MailService();
    const result = await mail.send({
      to: 'ada@example.com',
      subject: 'Confirm your AUTHENTIC email',
      template: 'verify-email',
      context: {
        firstName: 'Ada',
        code: '482910',
        token: 'xyz',
        verifyUrl: 'https://app.example/verify-email?token=xyz',
      },
    });
    expect(result).toEqual({ delivered: false, provider: 'log' });
  });
});

function restore(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
