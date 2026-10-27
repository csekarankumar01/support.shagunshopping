'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, api } from '@/lib/api';
import type { FormState } from '@/lib/form-state';

/** Admin only (the API enforces it). Sets a member's role and/or switches them on or off. */
export async function updateMember(userId: string, change: { role?: string; isActive?: boolean }): Promise<FormState> {
  try {
    await api(`/api/v1/team/${userId}`, { method: 'PATCH', body: change });
  } catch (err) {
    if (err instanceof ApiError) return { error: err.message };
    throw err;
  }
  revalidatePath('/team');
  return { ok: 'Saved.' };
}
