import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { apiRequest, ApiError } from './api';
import { PLATFORM_COOKIE } from './constants';

/**
 * The super admin console talks to /api/v1/platform with its own token, kept in its own httpOnly cookie. Like the
 * tenant login, page JavaScript never sees it. It lasts one hour (the API's limit); there is no refresh.
 */
export async function setPlatformSession(token: string, expiresIn: number) {
  (await cookies()).set(PLATFORM_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: expiresIn,
  });
}

export async function clearPlatformSession() {
  (await cookies()).delete(PLATFORM_COOKIE);
}

/** Calls the platform API. No cookie, or a token the API refuses, sends the visitor to the platform sign-in. */
export async function platformApi<T>(path: string, options: { method?: string; body?: unknown } = {}) {
  const token = (await cookies()).get(PLATFORM_COOKIE)?.value;
  if (!token) redirect('/platform/login');
  try {
    return await apiRequest<T>(`/api/v1/platform${path}`, options.method ?? 'GET', options.body, token);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect('/platform/login');
    throw err;
  }
}

export interface PlatformOrg {
  id: string;
  slug: string;
  name: string;
  plan: 'FREE' | 'PRO' | 'ENT';
  slaMins: number;
  status: 'ACTIVE' | 'SUSPENDED';
  admins: number;
  agents: number;
  customers: number;
  tickets: number;
  openTickets: number;
  createdAt: string;
  suspendedAt?: string | null;
  suspendedReason?: string | null;
}

export interface PlatformUser {
  id: string;
  email: string;
  role: 'ADMIN' | 'AGENT' | 'CUSTOMER';
  isActive: boolean;
  createdAt: string;
}

export interface PlatformTicketRow {
  id: string;
  subject: string;
  status: string;
  priority: string;
  requester: string;
  assignedTo: string | null;
  slaBreached: boolean;
  createdAt: string;
}

export interface PlatformTicket {
  id: string;
  orgId: string;
  organisation: string;
  subject: string;
  status: string;
  priority: string;
  requester: string;
  assignedTo: string | null;
  slaDeadline: string;
  slaBreached: boolean;
  createdAt: string;
  comments: { id: string; author: string; authorRole: string; message: string; isInternalNote: boolean; createdAt: string }[];
}

export interface PlatformOverview {
  organizations: number;
  suspended: number;
  newThisWeek: number;
  users: number;
  tickets: number;
  openTickets: number;
  breachedTickets: number;
  failedEvents: number;
}

export interface PlatformAuditEntry {
  id: number;
  adminEmail: string;
  action: string;
  orgId: string | null;
  targetType: string | null;
  targetId: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}
