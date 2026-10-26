import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { TOPICS } from './events.js';
import type { EventEnvelope } from './events.js';

/** Audit consumer: records that a ticket was created. Safe to run twice for the same ticket. */
@Injectable()
export class AuditSinkService {
  constructor(private readonly db: DatabaseService) {}

  async handle(event: EventEnvelope) {
    if (event.type !== TOPICS.TICKET_CREATED) return;
    const { data } = event as EventEnvelope<'ticket.created'>;
    await this.db.tenantQuery(
      event.orgId,
      `INSERT INTO audit_logs (org_id, ticket_id, actor_id, action, new_val)
       SELECT $1::uuid, $2::uuid, $3::uuid, 'TICKET_CREATED', $4::text
        WHERE NOT EXISTS (SELECT 1 FROM audit_logs
                           WHERE org_id = $1 AND ticket_id = $2 AND action = 'TICKET_CREATED')`,
      [data.ticketId, data.requesterId, data.priority],
    );
  }
}
