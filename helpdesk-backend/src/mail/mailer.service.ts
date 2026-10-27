import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport } from 'nodemailer';
import type { Transporter } from 'nodemailer';

/**
 * How the connection to the mail server is secured (SMTP_TLS):
 *   none      no encryption, no check: only for the local Mailpit catcher in development (the default)
 *   starttls  connect in the clear, then upgrade to TLS and REQUIRE it (typical for port 587)
 *   tls       TLS from the first byte (typical for port 465)
 * A real provider also needs SMTP_USER and SMTP_PASSWORD. Certificates are always verified except in `none` mode.
 */
type TlsMode = 'none' | 'starttls' | 'tls';

/** Sends real email over SMTP. In development the server is Mailpit, which keeps the mail for you to read. */
@Injectable()
export class MailerService {
  private readonly transport: Transporter;
  private readonly from: string;

  constructor(config: ConfigService) {
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
  }

  async send(to: string, subject: string, text: string) {
    await this.transport.sendMail({ from: this.from, to, subject, text });
  }
}
