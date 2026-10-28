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

    if (resendApiKey) {
      this.resend = new Resend(resendApiKey);
      this.from = config.get<string>('MAIL_FROM', 'onboarding@resend.dev');
      this.logger.log('Mailer initialized with Resend API');
    } else {
      this.from = config.get<string>('MAIL_FROM', 'helpdesk@localhost');
      this.logger.log('Mailer initialized with SMTP transport');
    }
  }

  async send(to: string, subject: string, text: string, html?: string) {
    if (this.resend && !to.endsWith('.test') && process.env.NODE_ENV !== 'test') {
      const { data, error } = await this.resend.emails.send({
        from: this.from,
        to,
        subject,
        text,
        html: html ?? this.textToHtml(text),
      });

      // If Resend test sandbox blocks sending to external recipients (only allows account owner email),
      // deliver to the account owner with the intended recipient clearly flagged so the flow never breaks.
      if (error && error.message?.includes('only send testing emails to your own email address')) {
        const ownerMatch = error.message.match(/own email address \(([^)]+)\)/);
        const ownerEmail = ownerMatch ? ownerMatch[1] : undefined;
        if (ownerEmail && ownerEmail !== to) {
          this.logger.warn(
            `Resend test sandbox restriction: delivering email intended for ${to} to verified owner ${ownerEmail}`,
          );
          const fallback = await this.resend.emails.send({
            from: this.from,
            to: ownerEmail,
            subject: `[For: ${to}] ${subject}`,
            text: `[Intended recipient: ${to}]\n\n${text}`,
            html:
              `<div style="padding: 10px; background: #fef3c7; border: 1px solid #f59e0b; border-radius: 6px; margin-bottom: 16px; font-family: sans-serif; font-size: 13px; color: #92400e;">` +
              `<strong>Resend Sandbox Notice:</strong> This email was intended for <code>${to}</code>.` +
              `</div>` +
              (html ?? this.textToHtml(text)),
          });
          if (!fallback.error) {
            return fallback.data;
          }
        }
      }

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

