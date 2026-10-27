import type { Role, TicketPriority, TicketStatus } from './constants';

// Shapes of the JSON the NestJS API returns (dates arrive as ISO strings).
export interface CurrentUser {
  userId: string;
  orgId: string;
  role: Role;
  email?: string;
  createdAt?: string;
  orgName?: string;
  orgSlug?: string;
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
  firstResponseAt: string | null;
  slaBreachedAt: string | null;
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

export interface TeamMember {
  userId: string;
  email: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
}

export interface CannedResponse {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface Stats {
  total: number;
  open: number;
  inProgress: number;
  resolved: number;
  closed: number;
  activeLow: number;
  activeMedium: number;
  activeHigh: number;
  activeUrgent: number;
  breached: number;
  unassigned: number;
  assignedToMe: number;
  createdLast24h: number;
  avgFirstResponseSeconds: number | null;
}

export interface NotificationRecord {
  id: string;
  ticketId: string;
  kind: 'TICKET_RECEIPT' | 'SLA_BREACH_ALERT';
  recipientEmail: string;
  subject: string;
  status: 'PENDING' | 'SENT' | 'FAILED';
  attempts: number;
  lastError: string | null;
  createdAt: string;
  sentAt: string | null;
}

export interface DeadLetterRecord {
  id: string;
  consumer: string;
  topic: string;
  eventId: string;
  eventType: string;
  error: string;
  attempts: number;
  createdAt: string;
}
