'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, api } from '@/lib/api';
import type { FormState } from '@/lib/form-state';

const text = (data: FormData, key: string) => String(data.get(key) ?? '').trim();

export async function createCanned(_prev: FormState, data: FormData): Promise<FormState> {
  const title = text(data, 'title');
  const body = text(data, 'body');
  try {
    await api('/api/v1/canned-responses', { method: 'POST', body: { title, body } });
  } catch (err) {
    if (err instanceof ApiError) return { error: err.message, fields: { title, body } };
    throw err;
  }
  revalidatePath('/canned');
  return { ok: 'Saved.' };
}

// The id is bound in by the page (deleteCanned.bind(null, id)).
export async function deleteCanned(id: string): Promise<FormState> {
  try {
    await api(`/api/v1/canned-responses/${id}`, { method: 'DELETE' });
  } catch (err) {
    if (err instanceof ApiError) return { error: err.message };
    throw err;
  }
  revalidatePath('/canned');
  return {};
}
