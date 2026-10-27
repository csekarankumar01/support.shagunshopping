'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiPublic } from '@/lib/api';
import type { FormState } from '@/lib/form-state';
import { clearPlatformSession, platformApi, setPlatformSession } from '@/lib/platform';

const text = (data: FormData, key: string) => String(data.get(key) ?? '').trim();

export async function platformLogin(_prev: FormState, data: FormData): Promise<FormState> {
  const email = text(data, 'email');
  const password = String(data.get('password') ?? '');
  try {
    const { accessToken, expiresIn } = await apiPublic<{ accessToken: string; expiresIn: number }>('/api/v1/platform/login', {
      email,
      password,
    });
    await setPlatformSession(accessToken, expiresIn);
  } catch (err) {
    if (err instanceof ApiError) return { error: err.message, fields: { email } };
    throw err;
  }
  redirect('/platform');
}

export async function platformLogout() {
  await clearPlatformSession();
  redirect('/platform/login');
}

async function run(work: () => Promise<unknown>, path: string, ok: string): Promise<FormState> {
  try {
    await work();
  } catch (err) {
    if (err instanceof ApiError) return { error: err.message };
    throw err;
  }
  revalidatePath(path);
  return { ok };
}

export async function updateOrganization(orgId: string, _prev: FormState, data: FormData): Promise<FormState> {
  const body = { name: text(data, 'name'), plan: text(data, 'plan'), slaMins: Number(text(data, 'slaMins')) };
  return run(() => platformApi(`/organizations/${orgId}`, { method: 'PATCH', body }), `/platform/organizations/${orgId}`, 'Saved.');
}

export async function suspendOrganization(orgId: string, _prev: FormState, data: FormData): Promise<FormState> {
  const reason = text(data, 'reason');
  return run(
    () => platformApi(`/organizations/${orgId}/suspend`, { method: 'POST', body: { reason } }),
    `/platform/organizations/${orgId}`,
    'Organisation suspended. Everyone in it has been signed out.',
  );
}

export async function activateOrganization(orgId: string): Promise<FormState> {
  return run(() => platformApi(`/organizations/${orgId}/activate`, { method: 'POST' }), `/platform/organizations/${orgId}`, 'Organisation reactivated.');
}

export async function updatePlatformUser(orgId: string, userId: string, change: { role?: string; isActive?: boolean }): Promise<FormState> {
  return run(() => platformApi(`/users/${userId}`, { method: 'PATCH', body: change }), `/platform/organizations/${orgId}`, 'Saved.');
}
