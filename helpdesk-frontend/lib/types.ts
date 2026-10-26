import type { Role, TicketPriority, TicketStatus } from './constants';

// Shapes of the JSON the NestJS API returns (dates arrive as ISO strings).
export interface CurrentUser {
  userId: string;
  orgId: string;
  role: Role;
}

export interface Ticket {
  id: string;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  requesterId: string;
  agentId: string | null;
  slaDeadline: string;
  createdAt: string;
}

/** Pushed over the socket when somebody is typing in a ticket you have open. */
export interface TypingEvent {
  ticketId: string;
  userId: string;
  role: Role;
  isTyping: boolean;
  isInternalNote: boolean;
}

export interface TicketPage {
  items: Ticket[];
  total: number;
  page: number;
  limit: number;
}

export interface TicketComment {
  id: string;
  ticketId: string;
  authorId: string;
  authorRole: Role;
  /** Null when the viewer is a customer and the author is someone else (staff addresses stay private). */
  authorEmail: string | null;
  message: string;
  isInternalNote: boolean;
  createdAt: string;
}
