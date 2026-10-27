'use server';

import { redirect } from 'next/navigation';
import { ApiError, api, apiPublic, apiRequest } from '@/lib/api';
import type { SessionTokens } from '@/lib/cookies';
import type { FormState } from '@/lib/form-state';
import { clearSession, getRefreshToken, setSession } from '@/lib/session';

const text = (data: FormData, key: string) => String(data.get(key) ?? '').trim();

async function signIn(orgSlug: string, email: string, password: string) {
  const tokens = await apiPublic<SessionTokens>('/api/v1/auth/login', { orgSlug, email, password });
  await setSession(tokens);
}

export async function login(_prev: FormState, data: FormData): Promise<FormState> {
  const orgSlug = text(data, 'orgSlug').toLowerCase();
  const email = text(data, 'email');
  const password = String(data.get('password') ?? ''); // never trimmed: spaces can be part of a password
  try {
    await signIn(orgSlug, email, password);
  } catch (err) {
    if (err instanceof ApiError) return { error: err.message, fields: { orgSlug, email } };
    throw err;
  }
  redirect('/tickets');
}

/** Creates the organisation and its first admin, then signs that admin straight in. */
export async function register(_prev: FormState, data: FormData): Promise<FormState> {
  const orgName = text(data, 'orgName');
  const orgSlug = text(data, 'orgSlug').toLowerCase();
  const email = text(data, 'email');
  const password = String(data.get('password') ?? '');
  try {
    await apiPublic('/api/v1/auth/register-org', { orgSlug, orgName, email, password });
    await signIn(orgSlug, email, password);
  } catch (err) {
    if (err instanceof ApiError) return { error: err.message, fields: { orgName, orgSlug, email } };
    throw err;
  }
  redirect('/tickets');
}

/** Ends this login on the server (so the tokens stop working at once, not just in this browser), then clears the cookies. */
export async function logout() {
  const refreshToken = await getRefreshToken();
  if (refreshToken) {
    // Best effort: whether or not the API could be reached, this browser is signed out.
    await apiRequest('/api/v1/auth/logout', 'POST', { refreshToken }).catch(() => undefined);
  }
  await clearSession();
  redirect('/login');
}

/** ADMIN only: the backend rejects anyone else with 403, whatever this form shows. */
export async function invite(_prev: FormState, data: FormData): Promise<FormState> {
  const email = text(data, 'email');
  const role = text(data, 'role');
  const password = String(data.get('password') ?? ''); // optional: blank means "email them a link to choose one"
  try {
    await api('/api/v1/auth/invite', { method: 'POST', body: { email, role, ...(password && { password }) } });
  } catch (err) {
    if (err instanceof ApiError) return { error: err.message, fields: { email, role } };
    throw err;
  }
  return {
    ok: password ? `Invited ${email} as ${role}.` : `Invited ${email} as ${role}. They have been emailed a link to choose a password.`,
  };
}
