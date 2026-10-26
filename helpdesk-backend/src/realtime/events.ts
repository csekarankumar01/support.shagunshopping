import type { Role } from '../auth/role.js';
import type { TicketStatus } from '../tickets/ticket.constants.js';

/**
 * Room names. Every one starts with the organisation id, so a room can never span two tenants.
 *   ticket        everyone allowed to see the ticket: its customer and the org's staff
 *   ticketStaff   only the org's staff watching that ticket (internal notes go here, never to `ticket` alone)
 *   agents        every connected staff member of the org (queue-wide events such as status changes)
 */
export const rooms = {
  ticket: (orgId: string, ticketId: string) =>
    `org:${orgId}:ticket:${ticketId}`,
  ticketStaff: (orgId: string, ticketId: string) =>
    `org:${orgId}:ticket:${ticketId}:staff`,
  agents: (orgId: string) => `org:${orgId}:agents`,
};

/** A comment as pushed to staff. Customers get the same shape with other people's `authorEmail` removed. */
export interface LiveComment {
  id: string;
  ticketId: string;
  authorId: string;
  authorRole: Role;
  authorEmail: string | null;
  message: string;
  isInternalNote: boolean;
  createdAt: Date;
}

export interface StatusChange {
  ticketId: string;
  status: TicketStatus;
}

export interface TypingEvent {
  ticketId: string;
  userId: string;
  role: Role;
  isTyping: boolean;
  isInternalNote: boolean;
}

/** What a handler answers to a client that asked for an acknowledgement. */
export type Ack = { ok: true } | { ok: false; error: string };
