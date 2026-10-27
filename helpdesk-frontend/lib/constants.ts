// Shared by server and client code, so nothing secret and nothing server-only belongs here.
// The lists mirror helpdesk-backend/src/tickets/ticket.constants.ts and src/auth/role.ts.
export const TOKEN_COOKIE = 'helpdesk_token';
export const REFRESH_COOKIE = 'helpdesk_refresh';

export const TICKET_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export type Role = 'ADMIN' | 'AGENT' | 'CUSTOMER';
export const isStaff = (role: Role) => role === 'ADMIN' || role === 'AGENT';
