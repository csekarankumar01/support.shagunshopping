import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { SupportGateway } from '../realtime/support.gateway.js';
import { TOPICS } from './events.js';
import type {
  EventEnvelope,
  SlaBreachedData,
  TicketCreatedData,
} from './events.js';
import { MailerService } from '../mail/mailer.service.js';

const MAX_ATTEMPTS = 4;

interface Recipient {
  id: string;
  email: string;
}

/**
 * Notification consumer: customer receipts, supervisor SLA alerts (email) and the live badge (WebSocket).
 * Idempotent: a redelivered event finds the notification row already SENT and sends nothing twice.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly mailer: MailerService,
    private readonly gateway: SupportGateway,
  ) {}

  async handle(event: EventEnvelope) {
    if (event.type === TOPICS.TICKET_CREATED) {
      return this.ticketCreated(event as EventEnvelope<'ticket.created'>);
    }
    if (event.type === TOPICS.SLA_BREACHED) {
      return this.slaBreached(event as EventEnvelope<'sla.breached'>);
    }
  }

  private async ticketCreated({
    orgId,
    data,
  }: EventEnvelope<'ticket.created'>) {
    const { rows } = await this.db.tenantQuery<Recipient>(
      orgId,
      'SELECT id, email FROM users WHERE org_id = $1 AND id = $2',
      [data.requesterId],
    );
    const requester = rows[0];
    if (requester) {
      await this.notify(orgId, data.ticketId, 'TICKET_RECEIPT', requester, {
        subject: `We received your request: ${data.subject}`,
        body: receiptBody(data),
      });
    }
    this.gateway.publishTicketCreated(orgId, {
      ticketId: data.ticketId,
      subject: data.subject,
      priority: data.priority,
    });
  }

  private async slaBreached({ orgId, data }: EventEnvelope<'sla.breached'>) {
    // Supervisors (admins) and, if there is one, the assigned agent.
    const { rows } = await this.db.tenantQuery<Recipient>(
      orgId,
      `SELECT id, email FROM users
        WHERE org_id = $1 AND (role = 'ADMIN' OR id = $2::uuid) ORDER BY email`,
      [data.agentId],
    );
    for (const recipient of rows) {
      await this.notify(orgId, data.ticketId, 'SLA_BREACH_ALERT', recipient, {
        subject: `SLA breached: ${data.subject}`,
        body: breachBody(data),
      });
    }
    this.gateway.publishSlaBreached(orgId, {
      ticketId: data.ticketId,
      subject: data.subject,
      priority: data.newPriority,
    });
  }

  /** Record, then send, then mark. The unique key makes the record step safe to repeat. */
  private async notify(
    orgId: string,
    ticketId: string,
    kind: 'TICKET_RECEIPT' | 'SLA_BREACH_ALERT',
    recipient: Recipient,
    message: { subject: string; body: string },
  ) {
    const { rows } = await this.db.tenantQuery<{
      id: string;
      status: string;
      attempts: number;
    }>(
      orgId,
      `INSERT INTO notifications (org_id, ticket_id, kind, recipient_id, recipient_email, subject, body)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (ticket_id, kind, recipient_id) DO UPDATE SET attempts = notifications.attempts
       RETURNING id, status, attempts`,
      [
        ticketId,
        kind,
        recipient.id,
        recipient.email,
        message.subject,
        message.body,
      ],
    );
    const row = rows[0];
    if (row.status === 'SENT') return; // a redelivery: already done
    try {
      await this.mailer.send(recipient.email, message.subject, message.body);
    } catch (err) {
      const attempts = row.attempts + 1;
      await this.db.tenantQuery(
        orgId,
        `UPDATE notifications SET attempts = $3, last_error = $4, status = $5
          WHERE org_id = $1 AND id = $2`,
        [
          row.id,
          attempts,
          (err as Error).message,
          attempts >= MAX_ATTEMPTS ? 'FAILED' : 'PENDING',
        ],
      );
      throw err; // the consumer retries, then dead-letters
    }
    await this.db.tenantQuery(
      orgId,
      `UPDATE notifications SET status = 'SENT', sent_at = now(), attempts = attempts + 1, last_error = NULL
        WHERE org_id = $1 AND id = $2`,
      [row.id],
    );
  }
}

const receiptBody = (d: TicketCreatedData) =>
  `Hello,\n\nWe have received your request "${d.subject}" (priority ${d.priority}).\n` +
  `Our team will respond before ${new Date(d.slaDeadline).toUTCString()}.\n\nTicket reference: ${d.ticketId}\n`;

const breachBody = (d: SlaBreachedData) =>
  `The ticket "${d.subject}" has missed its response deadline (${new Date(d.slaDeadline).toUTCString()}).\n` +
  `Its priority was raised from ${d.oldPriority} to ${d.newPriority}.\n\nTicket reference: ${d.ticketId}\n`;
