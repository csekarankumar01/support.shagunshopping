import { Module } from '@nestjs/common';
import { MailerService } from './mailer.service.js';

/** Sends email. Used by the notification consumer (receipts, SLA alerts) and by account flows (reset, invitations). */
@Module({ providers: [MailerService], exports: [MailerService] })
export class MailModule {}
