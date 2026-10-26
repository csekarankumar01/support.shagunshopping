import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { api } from './api';
import type { Role } from './constants';
import type { CurrentUser } from './types';

/**
 * Asks the API who the token belongs to (GET /auth/me), so the role comes from the backend's own
 * verification and the frontend never decodes or trusts the JWT itself. cache() makes the several
 * callers within one page render share a single request.
 */
export const getCurrentUser = cache(() => api<CurrentUser>('/api/v1/auth/me'));

/**
 * Sends other roles away from a page. This only keeps the UI tidy: the real enforcement is
 * the backend's guards, which reject the same calls with 403 whatever this page does.
 */
export async function requireRole(...roles: Role[]) {
  const user = await getCurrentUser();
  if (!roles.includes(user.role)) redirect('/tickets');
  return user;
}
