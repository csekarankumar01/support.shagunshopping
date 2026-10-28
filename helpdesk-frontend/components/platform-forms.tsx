'use client';

import { useActionState, useState, useTransition } from 'react';
import {
  activateOrganization,
  platformLogin,
  suspendOrganization,
  updateOrganization,
  updatePlatformUser,
} from '@/app/actions/platform';
import { Feedback, Field, inputClass, inlineSelectClass, selectClass, SubmitButton } from '@/components/forms';
import type { FormState } from '@/lib/form-state';
import type { PlatformOrg, PlatformUser } from '@/lib/platform';
import { useHydrated } from '@/lib/use-hydrated';

export function PlatformLoginForm() {
  const [state, action, pending] = useActionState(platformLogin, {});
  return (
    <form action={action} className="space-y-4">
      <Field label="Email">
        <input name="email" type="email" required defaultValue={state.fields?.email} className={inputClass} autoComplete="email" />
      </Field>
      <Field label="Password">
        <input name="password" type="password" required className={inputClass} autoComplete="current-password" />
      </Field>
      <Field label={state.error === 'Two-factor code required' ? 'Authenticator code (required for this account)' : 'Authenticator code (only if two-factor is on)'}>
        <input
          name="code"
          inputMode="numeric"
          pattern="[0-9 ]{6,7}"
          maxLength={7}
          autoComplete="one-time-code"
          autoFocus={state.error === 'Two-factor code required'}
          className={inputClass}
        />
      </Field>
      <Feedback state={state} />
      <SubmitButton pending={pending} idle="Sign in" busy="Signing in…" />
    </form>
  );
}

export function OrganizationForm({ org }: { org: PlatformOrg }) {
  const [state, action, pending] = useActionState(updateOrganization.bind(null, org.id), {});
  return (
    <form action={action} className="space-y-4">
      <Field label="Name">
        <input name="name" required maxLength={100} defaultValue={org.name} className={inputClass} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Plan">
          <select name="plan" defaultValue={org.plan} className={`${selectClass} max-w-[160px]`}>
            <option value="FREE">FREE</option>
            <option value="PRO">PRO</option>
            <option value="ENT">ENT</option>
          </select>
        </Field>
        <Field label="SLA (minutes to first reply)">
          <input name="slaMins" type="number" required min={1} max={10080} defaultValue={org.slaMins} className={inputClass} />
        </Field>
      </div>
      <Feedback state={state} />
      <SubmitButton pending={pending} idle="Save changes" busy="Saving…" />
    </form>
  );
}

/** Suspend asks for a reason (kept in the audit log); a suspended organisation shows a reactivate button instead. */
export function SuspendControls({ org }: { org: PlatformOrg }) {
  const [state, action, pending] = useActionState(suspendOrganization.bind(null, org.id), {});
  const [message, setMessage] = useState<FormState>({});
  const [busy, startTransition] = useTransition();
  const hydrated = useHydrated();
  if (org.status === 'SUSPENDED') {
    return (
      <div className="space-y-3">
        <p className="text-xs font-medium text-rose-700 dark:text-rose-300">
          Suspended: {org.suspendedReason ?? 'no reason recorded'}
        </p>
        <button
          type="button"
          disabled={busy || !hydrated}
          onClick={() => startTransition(async () => setMessage(await activateOrganization(org.id)))}
          className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-600/40 bg-emerald-50 px-4 py-2 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-60 dark:border-emerald-500/30 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-950/60"
        >
          Reactivate organisation
        </button>
        <Feedback state={message} />
        <Feedback state={{ ok: state.ok }} />
      </div>
    );
  }
  return (
    <form action={action} className="space-y-3">
      <Field label="Reason for suspending (kept in the audit log)">
        <input name="reason" required maxLength={500} className={inputClass} placeholder="Violation of Terms, abuse, payment delinquency..." />
      </Field>
      <Feedback state={state} />
      {message.ok && <Feedback state={{ ok: message.ok }} />}
      <button
        type="submit"
        disabled={pending || !hydrated}
        className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-rose-600 to-red-600 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-rose-600/25 transition hover:from-rose-500 hover:to-red-500 disabled:opacity-60"
      >
        {pending ? 'Suspending…' : 'Suspend organisation'}
      </button>
    </form>
  );
}

export function UserControls({ orgId, user }: { orgId: string; user: PlatformUser }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<FormState>({});
  const hydrated = useHydrated();
  const save = (change: { role?: string; isActive?: boolean }) =>
    startTransition(async () => setMessage(await updatePlatformUser(orgId, user.id, change)));
  return (
    <span className="flex flex-wrap items-center gap-2">
      <select
        key={user.role}
        aria-label={`Role of ${user.email}`}
        defaultValue={user.role}
        disabled={pending || !hydrated}
        onChange={(event) => save({ role: event.target.value })}
        className={`${inlineSelectClass} py-1 text-xs rounded-lg border border-slate-300 dark:border-white/10 bg-white/70 dark:bg-white/5 font-medium`}
      >
        <option value="ADMIN">ADMIN</option>
        <option value="AGENT">AGENT</option>
        <option value="CUSTOMER">CUSTOMER</option>
      </select>
      <button
        type="button"
        disabled={pending || !hydrated}
        onClick={() => save({ isActive: !user.isActive })}
        aria-label={`${user.isActive ? 'Deactivate' : 'Reactivate'} ${user.email}`}
        className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition disabled:opacity-60 ${
          user.isActive
            ? 'text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40'
            : 'text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40'
        }`}
      >
        {user.isActive ? 'Deactivate' : 'Reactivate'}
      </button>
      {message.error && (
        <span role="alert" className="text-xs text-rose-600 dark:text-rose-400 font-medium">
          {message.error}
        </span>
      )}
    </span>
  );
}
