'use client';

import { useActionState } from 'react';
import type { ReactNode } from 'react';
import { invite, login, register } from '@/app/actions/auth';
import { addComment, createTicket, updateStatus } from '@/app/actions/tickets';
import { TICKET_PRIORITIES, TICKET_STATUSES } from '@/lib/constants';
import type { TicketStatus } from '@/lib/constants';
import type { FormState } from '@/lib/form-state';
import { useHydrated } from '@/lib/use-hydrated';

// Each form binds a Server Action to useActionState: React submits the form to the server, keeps the
// action's returned FormState, and reports `pending` while it runs. Submit buttons stay disabled until the
// page's JavaScript has loaded (see SubmitButton).

const inputClass =
  'w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-neutral-700';
const buttonClass =
  'rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60';

/**
 * Disabled until the page's JavaScript has loaded. Before that, a click would make the browser post the form
 * the old-fashioned way, and with cacheComponents on, Next 16.4.3 answers such a post without the page's HTML
 * shell, so the visitor would see a blank page. Waiting a moment avoids that (a disabled default button also
 * stops Enter from submitting).
 */
function SubmitButton({ pending, idle, busy }: { pending: boolean; idle: string; busy: string }) {
  const hydrated = useHydrated();
  return (
    <button type="submit" disabled={pending || !hydrated} className={buttonClass}>
      {pending ? busy : idle}
    </button>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

function Feedback({ state }: { state: FormState }) {
  if (state.error)
    return (
      <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
        {state.error}
      </p>
    );
  if (state.ok)
    return (
      <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-950 dark:text-green-300">
        {state.ok}
      </p>
    );
  return null;
}

const priorityOptions = TICKET_PRIORITIES.map((p) => (
  <option key={p} value={p}>
    {p}
  </option>
));

export function LoginForm() {
  const [state, action, pending] = useActionState(login, {});
  return (
    <form action={action} className="space-y-4">
      <Field label="Organisation (slug)">
        <input name="orgSlug" required defaultValue={state.fields?.orgSlug} className={inputClass} autoComplete="organization" />
      </Field>
      <Field label="Email">
        <input name="email" type="email" required defaultValue={state.fields?.email} className={inputClass} autoComplete="email" />
      </Field>
      <Field label="Password">
        <input name="password" type="password" required className={inputClass} autoComplete="current-password" />
      </Field>
      <Feedback state={state} />
      <SubmitButton pending={pending} idle="Sign in" busy="Signing in…" />
    </form>
  );
}

export function RegisterForm() {
  const [state, action, pending] = useActionState(register, {});
  return (
    <form action={action} className="space-y-4">
      <Field label="Organisation name">
        <input name="orgName" required maxLength={100} defaultValue={state.fields?.orgName} className={inputClass} />
      </Field>
      <Field label="Organisation slug (lowercase letters, numbers, hyphens)">
        <input
          name="orgSlug"
          required
          minLength={3}
          maxLength={40}
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          defaultValue={state.fields?.orgSlug}
          className={inputClass}
        />
      </Field>
      <Field label="Admin email">
        <input name="email" type="email" required defaultValue={state.fields?.email} className={inputClass} autoComplete="email" />
      </Field>
      <Field label="Password (at least 8 characters)">
        <input name="password" type="password" required minLength={8} className={inputClass} autoComplete="new-password" />
      </Field>
      <Feedback state={state} />
      <SubmitButton pending={pending} idle="Create organisation" busy="Creating…" />
    </form>
  );
}

export function NewTicketForm() {
  const [state, action, pending] = useActionState(createTicket, {});
  return (
    <form action={action} className="space-y-4">
      <Field label="Subject">
        <input name="subject" required maxLength={200} defaultValue={state.fields?.subject} className={inputClass} />
      </Field>
      <Field label="Priority">
        <select name="priority" defaultValue={state.fields?.priority ?? 'MEDIUM'} className={inputClass}>
          {priorityOptions}
        </select>
      </Field>
      <Feedback state={state} />
      <SubmitButton pending={pending} idle="Submit ticket" busy="Submitting…" />
    </form>
  );
}

export function StatusForm({ ticketId, current }: { ticketId: string; current: TicketStatus }) {
  const [state, action, pending] = useActionState(updateStatus.bind(null, ticketId), {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <select name="status" defaultValue={current} aria-label="Status" className={`${inputClass} w-auto`}>
        {TICKET_STATUSES.map((s) => (
          <option key={s} value={s}>
            {s.replace('_', ' ')}
          </option>
        ))}
      </select>
      <SubmitButton pending={pending} idle="Update status" busy="Saving…" />
      <Feedback state={state} />
    </form>
  );
}

export function CommentForm({ ticketId, canWriteInternalNote }: { ticketId: string; canWriteInternalNote: boolean }) {
  const [state, action, pending] = useActionState(addComment.bind(null, ticketId), {});
  return (
    <form action={action} className="space-y-3">
      <textarea
        name="message"
        required
        maxLength={5000}
        rows={4}
        placeholder="Write a reply…"
        aria-label="Message"
        defaultValue={state.fields?.message}
        className={inputClass}
      />
      {canWriteInternalNote && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="isInternalNote" />
          Internal note (the customer cannot see it)
        </label>
      )}
      <Feedback state={state} />
      <SubmitButton pending={pending} idle="Send" busy="Sending…" />
    </form>
  );
}

export function InviteForm() {
  const [state, action, pending] = useActionState(invite, {});
  return (
    <form action={action} className="space-y-4">
      <Field label="Email">
        <input name="email" type="email" required defaultValue={state.fields?.email} className={inputClass} />
      </Field>
      <Field label="Temporary password (at least 8 characters)">
        <input name="password" type="password" required minLength={8} className={inputClass} autoComplete="new-password" />
      </Field>
      <Field label="Role">
        <select name="role" defaultValue={state.fields?.role ?? 'AGENT'} className={inputClass}>
          <option value="AGENT">AGENT</option>
          <option value="CUSTOMER">CUSTOMER</option>
        </select>
      </Field>
      <Feedback state={state} />
      <SubmitButton pending={pending} idle="Invite user" busy="Inviting…" />
    </form>
  );
}
