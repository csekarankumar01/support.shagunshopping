import type { TenantQuery } from '../database/database.service.js';

/** Every event the system publishes. The Kafka message key is always the org id, so one tenant's events stay in order. */
export const TOPICS = {
  TICKET_CREATED: 'ticket.created',
  SLA_BREACHED: 'sla.breached',
} as const;
export type Topic = (typeof TOPICS)[keyof typeof TOPICS];

export interface TicketCreatedData {
  ticketId: string;
  requesterId: string;
  subject: string;
  priority: string;
  slaDeadline: string;
  createdAt: string;
}

export interface SlaBreachedData {
  ticketId: string;
  subject: string;
  oldPriority: string;
  newPriority: string;
  agentId: string | null;
  slaDeadline: string;
  breachedAt: string;
}

export interface EventDataByTopic {
  'ticket.created': TicketCreatedData;
  'sla.breached': SlaBreachedData;
}

/** What travels on Kafka. `id` is the outbox row id: stable across redeliveries, so consumers can be idempotent. */
export interface EventEnvelope<T extends Topic = Topic> {
  id: string;
  type: T;
  version: 1;
  orgId: string;
  occurredAt: string;
  data: EventDataByTopic[T];
}

/**
 * Writes an event to the outbox. Call it with the SAME `q` as the change it announces (inside tenantTransaction),
 * so both commit or neither does. A relay publishes it to Kafka afterwards.
 */
export function enqueueEvent<T extends Topic>(
  q: TenantQuery,
  topic: T,
  data: EventDataByTopic[T],
) {
  const payload = {
    type: topic,
    version: 1,
    occurredAt: new Date().toISOString(),
    data,
  };
  return q(
    `INSERT INTO outbox_events (org_id, topic, event_key, payload)
     VALUES ($1::uuid, $2, $1::uuid::text, $3::jsonb)`,
    [topic, JSON.stringify(payload)],
  );
}
