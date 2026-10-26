'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, api } from '@/lib/api';
import type { FormState } from '@/lib/form-state';
import type { Ticket } from '@/lib/types';

const text = (data: FormData, key: string) => String(data.get(key) ?? '').trim();

// Every action below is a public POST endpoint, so none of them trusts the browser: each one
// calls the API with the caller's own token, and the API decides who may do what in which tenant.

export async function createTicket(_prev: FormState, data: FormData): Promise<FormState> {
  const subject = text(data, 'subject');
  const priority = text(data, 'priority');
  let ticket: Ticket;
  try {
    ticket = await api<Ticket>('/api/v1/tickets', { method: 'POST', body: { subject, priority } });
  } catch (err) {
    if (err instanceof ApiError) return { error: err.message, fields: { subject, priority } };
    throw err;
  }
  revalidatePath('/tickets');
  redirect(`/tickets/${ticket.id}`);
}

// The ticket id is bound in by the page (action.bind(null, id)), so the form signature is (state, formData).
export async function updateStatus(ticketId: string, _prev: FormState, data: FormData): Promise<FormState> {
  const status = text(data, 'status');
  try {
    await api(`/api/v1/tickets/${ticketId}/status`, { method: 'PATCH', body: { status } });
  } catch (err) {
    if (err instanceof ApiError) return { error: err.message };
    throw err;
  }
  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath('/tickets');
  return { ok: 'Status updated.' };
}

export async function addComment(ticketId: string, _prev: FormState, data: FormData): Promise<FormState> {
  const message = text(data, 'message');
  const isInternalNote = data.get('isInternalNote') === 'on';
  try {
    await api(`/api/v1/tickets/${ticketId}/comments`, {
      method: 'POST',
      body: { message, isInternalNote },
    });
  } catch (err) {
    if (err instanceof ApiError) return { error: err.message, fields: { message } };
    throw err;
  }
  revalidatePath(`/tickets/${ticketId}`);
  return { ok: isInternalNote ? 'Internal note added.' : 'Reply sent.' };
}

/** An empty choice means "nobody": the ticket becomes unassigned. */
export async function assignTicket(ticketId: string, _prev: FormState, data: FormData): Promise<FormState> {
  const agentId = text(data, 'agentId') || null;
  try {
    await api(`/api/v1/tickets/${ticketId}/assign`, { method: 'PATCH', body: { agentId } });
  } catch (err) {
    if (err instanceof ApiError) return { error: err.message };
    throw err;
  }
  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath('/tickets');
  return { ok: agentId ? 'Assigned.' : 'Unassigned.' };
}
