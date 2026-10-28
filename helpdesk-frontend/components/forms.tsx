'use client';

import { useActionState, useRef, useState, useTransition } from 'react';
import type { ReactNode } from 'react';
import { changePassword, forgotPassword, resetPassword, signOutEverywhere } from '@/app/actions/account';
import { invite, login, register, resendCode, verifyEmail } from '@/app/actions/auth';
import { createCanned, deleteCanned } from '@/app/actions/canned';
import { updateMember } from '@/app/actions/team';
import { addComment, assignTicket, createTicket, updateStatus } from '@/app/actions/tickets';
import { TICKET_PRIORITIES, TICKET_STATUSES } from '@/lib/constants';
import type { TicketStatus } from '@/lib/constants';
import type { FormState } from '@/lib/form-state';
import type { CannedResponse, TeamMember } from '@/lib/types';
import { emitTyping, stopTyping } from '@/lib/socket';
import { useHydrated } from '@/lib/use-hydrated';

// Each form binds a Server Action to useActionState: React submits the form to the server, keeps the
// action's returned FormState, and reports `pending` while it runs. Submit buttons stay disabled until the
// page's JavaScript has loaded (see SubmitButton).

export const inputClass =
  'w-full rounded-xl border border-slate-200/90 bg-white/80 px-3.5 py-2 text-sm shadow-xs outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-white/10 dark:bg-white/5 dark:hover:border-white/20';
export const selectClass =
  'w-full cursor-pointer appearance-none rounded-xl border border-slate-200/90 bg-white/80 pl-3.5 pr-8 py-2 text-sm shadow-xs outline-none transition hover:border-slate-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-white/10 dark:bg-white/5 dark:hover:border-white/20';
export const inlineSelectClass =
  'w-auto min-w-0 max-w-full cursor-pointer appearance-none rounded-xl border border-slate-200/90 bg-white/80 pl-3 pr-8 py-1.5 text-sm font-medium shadow-xs outline-none transition hover:border-slate-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-white/10 dark:bg-white/5 dark:hover:border-white/20';
export const buttonClass =
  'cursor-pointer rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-indigo-600/25 transition-all duration-150 hover:from-indigo-500 hover:to-violet-500 active:scale-[0.98] disabled:opacity-60';

/**
 * Disabled until the page's JavaScript has loaded. Before that, a click would make the browser post the form
 * the old-fashioned way, and with cacheComponents on, Next 16.4.3 answers such a post without the page's HTML
 * shell, so the visitor would see a blank page. Waiting a moment avoids that (a disabled default button also
 * stops Enter from submitting).
 */
export function SubmitButton({ pending, idle, busy }: { pending: boolean; idle: string; busy: string }) {
  const hydrated = useHydrated();
  return (
    <button type="submit" disabled={pending || !hydrated} className={buttonClass}>
      {pending ? busy : idle}
    </button>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

export function Feedback({ state }: { state: FormState }) {
  if (state.error)
    return (
      <p role="alert" className="break-words rounded-xl border border-red-200 bg-red-50/80 px-3.5 py-2.5 text-sm font-medium text-red-700 shadow-xs dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-300">
        {state.error}
      </p>
    );
  if (state.ok)
    return (
      <div role="status" className="break-words rounded-xl border border-emerald-200 bg-emerald-50/80 px-3.5 py-2.5 text-sm font-medium text-emerald-700 shadow-xs dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-300">
        <p>{state.ok}</p>
      </div>
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

/** Step 2 of sign-up: type the 6 digits from the email. */
export function VerifyEmailForm({ orgSlug, email }: { orgSlug: string; email: string }) {
  const [state, action, pending] = useActionState(verifyEmail.bind(null, orgSlug, email), {});
  const [note, setNote] = useState<FormState>({});
  const [resending, startResend] = useTransition();
  const hydrated = useHydrated();
  return (
    <div className="space-y-4">
      <form action={action} className="space-y-4">
        <Field label="Verification code">
          <input
            name="code"
            required
            inputMode="numeric"
            pattern="[0-9 ]{6,7}"
            maxLength={7}
            autoComplete="one-time-code"
            autoFocus
            placeholder="123456"
            className={`${inputClass} text-center font-mono text-lg tracking-[0.4em]`}
          />
        </Field>
        <Feedback state={state} />
        <SubmitButton pending={pending} idle="Verify and create organisation" busy="Verifying…" />
      </form>
      <div className="space-y-2 text-sm">
        <button
          type="button"
          disabled={resending || !hydrated}
          onClick={() => startResend(async () => setNote(await resendCode(orgSlug, email)))}
          className="text-indigo-600 hover:underline disabled:opacity-60 dark:text-indigo-400"
        >
          Send a new code
        </button>
        <Feedback state={note} />
      </div>
    </div>
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
        <select name="priority" defaultValue={state.fields?.priority ?? 'MEDIUM'} className={`${selectClass} max-w-[220px]`}>
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
      {/* key: a new status (ours or a colleague's, pushed live) mounts a fresh select showing it. Mounting is what
          makes it survive React's reset of the form after an action; an updated select would snap back to OPEN. */}
      <select key={current} name="status" defaultValue={current} aria-label="Status" className={inlineSelectClass}>
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

export function CommentForm({
  ticketId,
  canWriteInternalNote,
  canned = [],
}: {
  ticketId: string;
  canWriteInternalNote: boolean;
  canned?: CannedResponse[];
}) {
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const [state, action, pending] = useActionState(async (previous: FormState, data: FormData) => {
    stopTyping(ticketId); // sending ends "is typing"
    return addComment(ticketId, previous, data);
  }, {});
  return (
    <form action={action} className="space-y-3">
      {canned.length > 0 && (
        <select
          aria-label="Insert a canned response"
          defaultValue=""
          className={inlineSelectClass}
          onChange={(event) => {
            const chosen = canned.find((c) => c.id === event.target.value);
            if (chosen && messageRef.current) {
              messageRef.current.value = chosen.body;
              messageRef.current.focus();
            }
            event.target.value = ''; // back to the prompt, ready for the next one
          }}
        >
          <option value="">Insert a canned response…</option>
          {canned.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
      )}
      <textarea
        ref={messageRef}
        name="message"
        required
        maxLength={5000}
        rows={4}
        placeholder="Write a reply…"
        aria-label="Message"
        defaultValue={state.fields?.message}
        className={inputClass}
        onInput={(event) => {
          // Typing an internal note is announced to staff only (the server enforces it too).
          const note = event.currentTarget.form?.elements.namedItem('isInternalNote') as HTMLInputElement | null;
          emitTyping(ticketId, note?.checked ?? false);
        }}
        onBlur={() => stopTyping(ticketId)}
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
  const [manualPassword, setManualPassword] = useState(false);
  return (
    <form action={action} className="space-y-4">
      <Field label="Email">
        <input
          name="email"
          type="email"
          required
          placeholder="colleague@example.com"
          defaultValue={state.fields?.email}
          className={inputClass}
          autoComplete="off"
        />
      </Field>
      <Field label="Role">
        <select name="role" defaultValue={state.fields?.role ?? 'AGENT'} className={`${selectClass} max-w-[220px]`}>
          <option value="AGENT">Support Agent</option>
          <option value="CUSTOMER">Customer</option>
        </select>
      </Field>
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-400 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={manualPassword}
            onChange={(e) => setManualPassword(e.target.checked)}
            className="rounded border-slate-300 dark:border-white/20"
          />
          <span>Set password manually (skip invitation email)</span>
        </label>
        {manualPassword ? (
          <div className="pt-1">
            <input
              name="password"
              type="password"
              required
              minLength={8}
              maxLength={72}
              placeholder="Temporary password (min 8 characters)"
              className={inputClass}
              autoComplete="new-password"
            />
          </div>
        ) : (
          <p className="text-xs text-indigo-600 dark:text-indigo-400">
            ✉️ An invitation email with a secure link to choose a password will be sent automatically via Resend.
          </p>
        )}
      </div>
      <Feedback state={state} />
      <SubmitButton pending={pending} idle="Invite user" busy="Inviting…" />
    </form>
  );
}

export function AssignForm({ ticketId, current, staff, myId }: { ticketId: string; current: string | null; staff: TeamMember[]; myId: string }) {
  const [state, action, pending] = useActionState(assignTicket.bind(null, ticketId), {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      {/* keyed on the real assignee, like the status select, so it survives React's form reset and live changes */}
      <select key={current ?? 'none'} name="agentId" defaultValue={current ?? ''} aria-label="Assignee" className={inlineSelectClass}>
        <option value="">Unassigned</option>
        {staff.map((member) => (
          <option key={member.userId} value={member.userId}>
            {member.email}
            {member.userId === myId ? ' (me)' : ''}
          </option>
        ))}
      </select>
      <SubmitButton pending={pending} idle="Assign" busy="Saving…" />
      <Feedback state={state} />
    </form>
  );
}

export function CannedForm() {
  const [state, action, pending] = useActionState(createCanned, {});
  return (
    <form action={action} className="space-y-4">
      <Field label="Title">
        <input name="title" required maxLength={100} defaultValue={state.fields?.title} className={inputClass} />
      </Field>
      <Field label="Text">
        <textarea name="body" required maxLength={5000} rows={4} defaultValue={state.fields?.body} className={inputClass} />
      </Field>
      <Feedback state={state} />
      <SubmitButton pending={pending} idle="Save canned response" busy="Saving…" />
    </form>
  );
}

export function DeleteCannedForm({ id, title }: { id: string; title: string }) {
  const [state, action, pending] = useActionState(deleteCanned.bind(null, id), {});
  const hydrated = useHydrated();
  return (
    <form action={action}>
      <button
        type="submit"
        disabled={pending || !hydrated}
        aria-label={`Delete ${title}`}
        className="cursor-pointer rounded-lg border border-red-200/80 bg-red-50/70 px-2.5 py-1 text-xs font-semibold text-red-700 shadow-xs transition hover:bg-red-100 disabled:opacity-60 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300 dark:hover:bg-red-900/50"
      >
        {pending ? 'Deleting…' : 'Delete'}
      </button>
      <Feedback state={state} />
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(forgotPassword, {});
  return (
    <form action={action} className="space-y-4">
      <Field label="Organisation (slug)">
        <input name="orgSlug" required defaultValue={state.fields?.orgSlug} className={inputClass} autoComplete="organization" />
      </Field>
      <Field label="Email">
        <input name="email" type="email" required defaultValue={state.fields?.email} className={inputClass} autoComplete="email" />
      </Field>
      <Feedback state={state} />
      <SubmitButton pending={pending} idle="Email me a reset link" busy="Sending…" />
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetPassword, {});
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <Field label="New password (8 to 72 characters)">
        <input name="newPassword" type="password" required minLength={8} maxLength={72} className={inputClass} autoComplete="new-password" />
      </Field>
      <Field label="Repeat the new password">
        <input name="confirm" type="password" required minLength={8} maxLength={72} className={inputClass} autoComplete="new-password" />
      </Field>
      <Feedback state={state} />
      <SubmitButton pending={pending} idle="Set password" busy="Saving…" />
    </form>
  );
}

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState(changePassword, {});
  return (
    <form action={action} className="space-y-4">
      <Field label="Current password">
        <input name="currentPassword" type="password" required className={inputClass} autoComplete="current-password" />
      </Field>
      <Field label="New password (8 to 72 characters)">
        <input name="newPassword" type="password" required minLength={8} maxLength={72} className={inputClass} autoComplete="new-password" />
      </Field>
      <Field label="Repeat the new password">
        <input name="confirm" type="password" required minLength={8} maxLength={72} className={inputClass} autoComplete="new-password" />
      </Field>
      <Feedback state={state} />
      <SubmitButton pending={pending} idle="Change password" busy="Saving…" />
    </form>
  );
}

/** A plain form whose action signs the user out of every device. */
export function SignOutEverywhereForm() {
  const hydrated = useHydrated();
  return (
    <form action={signOutEverywhere}>
      <button
        type="submit"
        disabled={!hydrated}
        className="w-full rounded-xl border border-red-300/80 bg-red-50/70 px-4 py-2.5 text-sm font-semibold text-red-700 shadow-sm transition-all duration-150 hover:bg-red-100 hover:shadow active:scale-[0.99] disabled:opacity-60 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950/70"
      >
        Sign out of all devices
      </button>
    </form>
  );
}

/** Role and on/off controls for one member (admin only; the API enforces the same rules). */
export function MemberControls({ member }: { member: TeamMember }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<FormState>({});
  const hydrated = useHydrated();
  const save = (change: { role?: string; isActive?: boolean }) =>
    startTransition(async () => setMessage(await updateMember(member.userId, change)));
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Role:</span>
      <select
        key={member.role}
        aria-label={`Role of ${member.email}`}
        defaultValue={member.role}
        disabled={pending || !hydrated}
        onChange={(event) => save({ role: event.target.value })}
        className={`${inlineSelectClass} py-1 text-xs`}
      >
        <option value="AGENT">AGENT</option>
        <option value="CUSTOMER">CUSTOMER</option>
      </select>
      <button
        type="button"
        disabled={pending || !hydrated}
        onClick={() => save({ isActive: !member.isActive })}
        aria-label={`${member.isActive ? 'Deactivate' : 'Reactivate'} ${member.email}`}
        className={`cursor-pointer rounded-lg px-2.5 py-1 text-xs font-semibold transition disabled:opacity-60 ${
          member.isActive
            ? 'border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-900/60'
            : 'border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-900/60'
        }`}
      >
        {member.isActive ? 'Deactivate' : 'Reactivate'}
      </button>
      {message.error && (
        <span role="alert" className="text-xs text-red-600 dark:text-red-400">
          {message.error}
        </span>
      )}
    </div>
  );
}
