'use server';

import { revalidatePath } from 'next/cache';
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
  let verificationRequired = false;
  try {
    const created = await apiPublic<{ verificationRequired?: boolean }>('/api/v1/auth/register-org', { orgSlug, orgName, email, password });
    verificationRequired = created.verificationRequired === true;
    // With email verification switched off on the server the organisation exists already: sign straight in.
    if (!verificationRequired) await signIn(orgSlug, email, password);
  } catch (err) {
    if (err instanceof ApiError) return { error: err.message, fields: { orgName, orgSlug, email } };
    throw err;
  }
  // Otherwise a 6-digit code has been emailed; nothing exists until it is entered.
  if (verificationRequired) redirect(`/verify-email?org=${encodeURIComponent(orgSlug)}&email=${encodeURIComponent(email)}`);
  redirect('/tickets');
}

/** Step 2 of sign-up: the emailed code creates the organisation. The password is not kept, so the person signs in next. */
export async function verifyEmail(orgSlug: string, email: string, _prev: FormState, data: FormData): Promise<FormState> {
  const code = text(data, 'code').replace(/\s/g, '');
  try {
    await apiPublic('/api/v1/auth/verify-registration', { orgSlug, email, code });
  } catch (err) {
    if (err instanceof ApiError) return { error: err.message };
    throw err;
  }
  redirect(`/login?verified=1&org=${encodeURIComponent(orgSlug)}`);
}

export async function resendCode(orgSlug: string, email: string): Promise<FormState> {
  try {
    await apiPublic('/api/v1/auth/resend-registration-code', { orgSlug, email });
  } catch (err) {
    if (err instanceof ApiError) return { error: err.message };
    throw err;
  }
  return { ok: 'If that sign-up is still open, a new code is on its way.' };
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
    const res = await api<{ invitationSent?: boolean; inviteLink?: string; emailWarning?: string }>(
      '/api/v1/auth/invite',
      { method: 'POST', body: { email, role, ...(password && { password }) } },
    );
    revalidatePath('/team');
    if (res?.emailWarning) {
      return {
        ok: `Invited ${email} as ${role}. Note: Resend delivery restriction (${res.emailWarning}). You can copy and send them this direct password setup link: ${res.inviteLink}`,
      };
    }
    return {
      ok: password
        ? `Invited ${email} as ${role}.`
        : `Invited ${email} as ${role}. They have been emailed a link to choose a password.`,
    };
  } catch (err) {
    if (err instanceof ApiError) return { error: err.message, fields: { email, role } };
    throw err;
  }
}
