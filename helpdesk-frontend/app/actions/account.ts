'use server';

import { redirect } from 'next/navigation';
import { ApiError, api, apiPublic } from '@/lib/api';
import type { FormState } from '@/lib/form-state';
import { clearSession } from '@/lib/session';

const text = (data: FormData, key: string) => String(data.get(key) ?? '').trim();
const secret = (data: FormData, key: string) => String(data.get(key) ?? ''); // passwords are never trimmed

/** Same reply whether or not the account exists, so this page cannot be used to find out who has one. */
export async function forgotPassword(_prev: FormState, data: FormData): Promise<FormState> {
  const orgSlug = (text(data, 'orgSlug') || 'shagun').toLowerCase();
  const email = text(data, 'email');
  try {
    await apiPublic('/api/v1/auth/forgot-password', { orgSlug, email });
  } catch (err) {
    if (err instanceof ApiError) return { error: err.message, fields: { orgSlug, email } };
    throw err;
  }
  return { ok: 'If that account exists, we have emailed it a link to choose a new password. It works once and expires in an hour.' };
}

// The reset token comes from the emailed link (a hidden field), never from anything the visitor types.
export async function resetPassword(_prev: FormState, data: FormData): Promise<FormState> {
  const token = text(data, 'token');
  const newPassword = secret(data, 'newPassword');
  if (newPassword !== secret(data, 'confirm')) return { error: 'The two passwords do not match.' };
  try {
    await apiPublic('/api/v1/auth/reset-password', { token, newPassword });
  } catch (err) {
    if (err instanceof ApiError) return { error: err.message };
    throw err;
  }
  redirect('/login?reset=1');
}

export async function changePassword(_prev: FormState, data: FormData): Promise<FormState> {
  const currentPassword = secret(data, 'currentPassword');
  const newPassword = secret(data, 'newPassword');
  if (newPassword !== secret(data, 'confirm')) return { error: 'The two new passwords do not match.' };
  try {
    await api('/api/v1/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } });
  } catch (err) {
    if (err instanceof ApiError) return { error: err.message };
    throw err;
  }
  return { ok: 'Password changed. Your other devices have been signed out.' };
}

/** Ends every session of this user, including this one. */
export async function signOutEverywhere() {
  await api('/api/v1/auth/logout-all', { method: 'POST' });
  await clearSession();
  redirect('/login');
}
