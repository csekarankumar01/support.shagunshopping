import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport } from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { Resend } from 'resend';

/**
 * How the connection to the mail server is secured (SMTP_TLS):
 *   none      no encryption, no check: only for the local Mailpit catcher in development (the default)
 *   starttls  connect in the clear, then upgrade to TLS and REQUIRE it (typical for port 587)
 *   tls       TLS from the first byte (typical for port 465)
 * A real provider also needs SMTP_USER and SMTP_PASSWORD. Certificates are always verified except in `none` mode.
 */
type TlsMode = 'none' | 'starttls' | 'tls';

/** Sends email via Resend API (if RESEND_API_KEY is configured) or SMTP (Mailpit locally, or SMTP relay). */
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private readonly resend?: Resend;
  private readonly transport?: Transporter;
  private readonly from: string;

  constructor(config: ConfigService) {
    const resendApiKey = config.get<string>('RESEND_API_KEY')?.trim();

    if (resendApiKey) {
      this.resend = new Resend(resendApiKey);
      this.from = config.get<string>('MAIL_FROM', 'onboarding@resend.dev');
      this.logger.log('Mailer initialized with Resend API');
    } else {
      this.from = config.get<string>('MAIL_FROM', 'helpdesk@localhost');
      const mode = config.get<string>('SMTP_TLS', 'none') as TlsMode;
      if (!['none', 'starttls', 'tls'].includes(mode)) {
        throw new Error(`SMTP_TLS must be none, starttls or tls (got "${mode}")`);
      }
      const user = config.get<string>('SMTP_USER');
      this.transport = createTransport({
        host: config.get<string>('SMTP_HOST', 'localhost'),
        port: Number(config.get<string>('SMTP_PORT', '4025')),
        secure: mode === 'tls',
        ignoreTLS: mode === 'none',
        requireTLS: mode === 'starttls', // never fall back to sending credentials and mail unencrypted
        auth: user ? { user, pass: config.get<string>('SMTP_PASSWORD', '') } : undefined,
        connectionTimeout: 5000,
        socketTimeout: 10_000,
      });
      this.logger.log('Mailer initialized with SMTP transport');
    }
  }

  async send(to: string, subject: string, text: string, html?: string) {
    if (this.resend) {
      const { data, error } = await this.resend.emails.send({
        from: this.from,
        to,
        subject,
        text,
        html: html ?? this.textToHtml(text),
      });
      if (error) {
        this.logger.error(`Resend email delivery failed to ${to}: ${error.message}`);
        throw new Error(`Resend error: ${error.message}`);
      }
      return data;
    }

    if (this.transport) {
      await this.transport.sendMail({
        from: this.from,
        to,
        subject,
        text,
        ...(html ? { html } : {}),
      });
    }
  }

  private textToHtml(text: string): string {
    const escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return (
      `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 15px; line-height: 1.6; color: #1e293b;">` +
      escaped
        .split('\n\n')
        .map((p) => `<p style="margin: 0 0 16px 0;">${p.replace(/\n/g, '<br/>')}</p>`)
        .join('') +
      `</div>`
    );
  }
}

