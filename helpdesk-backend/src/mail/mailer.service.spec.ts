import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { MailerService } from './mailer.service.js';

describe('MailerService', () => {
  it('initializes with SMTP when RESEND_API_KEY is not set', () => {
    const config = new ConfigService({
      MAIL_FROM: 'test@example.com',
      SMTP_HOST: 'localhost',
      SMTP_PORT: '4025',
      SMTP_TLS: 'none',
    });
    const mailer = new MailerService(config);
    expect(mailer).toBeDefined();
  });

  it('initializes with Resend when RESEND_API_KEY is provided', () => {
    const config = new ConfigService({
      RESEND_API_KEY: 're_test_123456789',
      MAIL_FROM: 'Acme <onboarding@resend.dev>',
    });
    const mailer = new MailerService(config);
    expect(mailer).toBeDefined();
  });
});
