import { Suspense } from 'react';
import { ChangePasswordForm, SignOutEverywhereForm } from '@/components/forms';
import { getCurrentUser } from '@/lib/auth';

export default function AccountPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent dark:border-indigo-400" />
        </div>
      }
    >
      <Account />
    </Suspense>
  );
}

async function Account() {
  const user = await getCurrentUser();

  const formattedDate = user.createdAt
    ? new Date(user.createdAt).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : 'Active';

  const initial = (user.email?.[0] || user.role[0] || 'U').toUpperCase();

  const roleBadgeStyle =
    user.role === 'ADMIN'
      ? 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300'
      : user.role === 'AGENT'
      ? 'border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300'
      : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';

  return (
    <div className="mx-auto max-w-4xl space-y-8 pb-12">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-3xl">
          Account Settings
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Manage your personal profile, security credentials, and active sessions.
        </p>
      </div>

      {/* Profile Overview Card */}
      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/70 shadow-sm backdrop-blur-md dark:border-white/10 dark:bg-white/5">
        <div className="border-b border-slate-200/70 bg-gradient-to-r from-indigo-50/50 via-purple-50/30 to-transparent p-6 dark:border-white/10 dark:from-indigo-950/20 dark:via-purple-950/10">
          <div className="flex flex-wrap items-center gap-4 sm:gap-6">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 via-indigo-700 to-violet-700 text-2xl font-bold text-white shadow-lg shadow-indigo-600/30">
              {initial}
            </div>
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                  {user.email || 'Administrator Account'}
                </h2>
                <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${roleBadgeStyle}`}>
                  {user.role}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Active
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Organization: <span className="font-medium text-slate-700 dark:text-slate-300">{user.orgName || 'Acme Support'}</span> ({user.orgSlug || 'acme'})
              </p>
            </div>
          </div>
        </div>

        {/* Detailed Metadata Grid */}
        <div className="grid grid-cols-1 gap-4 p-6 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-slate-200/60 bg-white/50 p-4 dark:border-white/5 dark:bg-white/[0.02]">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Email Address
            </span>
            <p className="mt-1 font-semibold text-slate-900 dark:text-white truncate" title={user.email}>
              {user.email || 'admin@acme.com'}
            </p>
          </div>

          <div className="rounded-xl border border-slate-200/60 bg-white/50 p-4 dark:border-white/5 dark:bg-white/[0.02]">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Organization
            </span>
            <p className="mt-1 font-semibold text-slate-900 dark:text-white truncate">
              {user.orgName || 'Acme Support'}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-mono mt-0.5">
              slug: {user.orgSlug || 'acme'}
            </p>
          </div>

          <div className="rounded-xl border border-slate-200/60 bg-white/50 p-4 dark:border-white/5 dark:bg-white/[0.02]">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Member Since
            </span>
            <p className="mt-1 font-semibold text-slate-900 dark:text-white">
              {formattedDate}
            </p>
          </div>

          <div className="rounded-xl border border-slate-200/60 bg-white/50 p-4 dark:border-white/5 dark:bg-white/[0.02]">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Role & Permissions
            </span>
            <p className="mt-1 font-semibold text-slate-900 dark:text-white">
              {user.role === 'ADMIN' ? 'Full Administrator' : user.role === 'AGENT' ? 'Support Agent' : 'Customer Portal'}
            </p>
          </div>

          <div className="rounded-xl border border-slate-200/60 bg-white/50 p-4 dark:border-white/5 dark:bg-white/[0.02] sm:col-span-2">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
              User ID
            </span>
            <p className="mt-1 font-mono text-xs text-slate-700 dark:text-slate-300 break-all select-all">
              {user.userId}
            </p>
          </div>
        </div>
      </div>

      {/* Grid of Security & Sessions Actions */}
      <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
        {/* Change Password Card */}
        <div className="flex flex-col justify-between rounded-2xl border border-slate-200/80 bg-white/70 p-6 shadow-sm backdrop-blur-md dark:border-white/10 dark:bg-white/5">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <div>
                <h2 className="font-semibold text-slate-900 dark:text-white">Change password</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Changing your password signs out other active devices.
                </p>
              </div>
            </div>
            <ChangePasswordForm />
          </div>
        </div>

        {/* Sessions Card */}
        <div className="flex flex-col justify-between rounded-2xl border border-slate-200/80 bg-white/70 p-6 shadow-sm backdrop-blur-md dark:border-white/10 dark:bg-white/5">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </div>
              <div>
                <h2 className="font-semibold text-slate-900 dark:text-white">Session Security</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Signed in somewhere you no longer trust?
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-amber-200/60 bg-amber-50/50 p-4 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300">
              <p className="font-medium">Active Security Note</p>
              <p className="mt-1 text-amber-700/90 dark:text-amber-400/90">
                Revoking your sessions immediately invalidates all access tokens across every browser and device, including this current session.
              </p>
            </div>

            <div className="pt-2">
              <SignOutEverywhereForm />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
