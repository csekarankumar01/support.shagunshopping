import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport } from 'nodemailer';
import type { Transporter } from 'nodemailer';

/** Sends real email over SMTP. In development the server is Mailpit, which keeps the mail for you to read. */
@Injectable()
export class MailerService {
  private readonly transport: Transporter;
  private readonly from: string;

  constructor(config: ConfigService) {
    this.from = config.get<string>('MAIL_FROM', 'helpdesk@localhost');
    this.transport = createTransport({
      host: config.get<string>('SMTP_HOST', 'localhost'),
      port: Number(config.get<string>('SMTP_PORT', '4025')),
      secure: false,
      ignoreTLS: true, // local catcher only; a real provider needs TLS and credentials in .env
      connectionTimeout: 5000,
      socketTimeout: 10_000,
    });
  }

  async send(to: string, subject: string, text: string) {
    await this.transport.sendMail({ from: this.from, to, subject, text });
  }
}
