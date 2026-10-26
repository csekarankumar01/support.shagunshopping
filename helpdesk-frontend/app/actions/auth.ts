'use server';

import { redirect } from 'next/navigation';
import { ApiError, api, apiPublic } from '@/lib/api';
import type { FormState } from '@/lib/form-state';
import { clearToken, setToken } from '@/lib/session';

const text = (data: FormData, key: string) => String(data.get(key) ?? '').trim();

async function signIn(orgSlug: string, email: string, password: string) {
  const { accessToken } = await apiPublic<{ accessToken: string }>('/api/v1/auth/login', {
    orgSlug,
    email,
    password,
  });
  await setToken(accessToken);
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
    await apiPublic('/api/v1/auth/register-org', { orgName, orgSlug, email, password });
    await signIn(orgSlug, email, password);
  } catch (err) {
    if (err instanceof ApiError) return { error: err.message, fields: { orgName, orgSlug, email } };
    throw err;
  }
  redirect('/tickets');
}

export async function logout() {
  await clearToken();
  redirect('/login');
}

/** ADMIN only: the backend rejects anyone else with 403, whatever this form shows. */
export async function invite(_prev: FormState, data: FormData): Promise<FormState> {
  const email = text(data, 'email');
  const role = text(data, 'role');
  const password = String(data.get('password') ?? '');
  try {
    await api('/api/v1/auth/invite', { method: 'POST', body: { email, password, role } });
  } catch (err) {
    if (err instanceof ApiError) return { error: err.message, fields: { email, role } };
    throw err;
  }
  return { ok: `Invited ${email} as ${role}.` };
}
