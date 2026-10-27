import { Suspense } from 'react';
import { InviteForm, MemberControls } from '@/components/forms';
import { LocalTime } from '@/components/local-time';
import { api } from '@/lib/api';
import { requireRole } from '@/lib/auth';
import type { TeamMember } from '@/lib/types';

export default function TeamPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-16 text-sm text-slate-500 dark:text-slate-400">
          <div className="flex items-center gap-2">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
            Loading team members…
          </div>
        </div>
      }
    >
      <Team />
    </Suspense>
  );
}

// Admins only: everyone in the organisation, role and on/off controls, and the way to add agents and customers.
async function Team() {
  const me = await requireRole('ADMIN');
  const members = await api<TeamMember[]>('/api/v1/team');

  const roleBadgeStyle = (role: string) => {
    switch (role) {
      case 'ADMIN':
        return 'bg-purple-100 text-purple-700 border border-purple-200/80 dark:bg-purple-950/60 dark:text-purple-300 dark:border-purple-800/60';
      case 'AGENT':
        return 'bg-indigo-100 text-indigo-700 border border-indigo-200/80 dark:bg-indigo-950/60 dark:text-indigo-300 dark:border-indigo-800/60';
      default:
        return 'bg-slate-100 text-slate-700 border border-slate-200 dark:bg-white/10 dark:text-slate-300 dark:border-white/10';
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Team</h1>
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700 dark:bg-white/10 dark:text-slate-300">
            {members.length} {members.length === 1 ? 'member' : 'members'}
          </span>
        </div>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Manage member accounts, permissions, and invite new colleagues to your workspace.
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-5">
        {/* Left: Member Directory (3 columns on lg) */}
        <section className="space-y-4 lg:col-span-3">
          <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-5 shadow-sm backdrop-blur-md dark:border-white/10 dark:bg-white/5">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Workspace Members ({members.length})
            </h2>

            <ul className="divide-y divide-slate-100 dark:divide-white/10">
              {members.map((member) => (
                <li key={member.userId} className="space-y-3 py-4 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-bold text-white shadow-xs">
                          {member.email.charAt(0).toUpperCase()}
                        </span>
                        <span
                          className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white dark:border-[#0b1020] ${
                            member.isActive ? 'bg-emerald-500' : 'bg-red-500'
                          }`}
                          title={member.isActive ? 'Active' : 'Deactivated'}
                        />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`font-semibold text-slate-900 [overflow-wrap:anywhere] dark:text-slate-100 ${
                              member.isActive ? '' : 'text-slate-400 line-through dark:text-slate-500'
                            }`}
                          >
                            {member.email}
                          </span>
                          {member.userId === me.userId && (
                            <span className="rounded-md bg-slate-100 px-1.5 py-0.2 text-[10px] font-semibold text-slate-600 dark:bg-white/10 dark:text-slate-300">
                              You
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Joined <LocalTime iso={member.createdAt} />
                        </p>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2 text-xs">
                      {!member.isActive && (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 font-semibold text-red-800 dark:bg-red-950 dark:text-red-300">
                          Deactivated
                        </span>
                      )}

                      {(member.role === 'ADMIN' || member.userId === me.userId) && (
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${roleBadgeStyle(member.role)}`}>
                          {member.role}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Admins (including you) cannot be changed here: the API refuses it too. */}
                  {member.role !== 'ADMIN' && member.userId !== me.userId && (
                    <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-2.5 dark:border-white/5 dark:bg-white/[0.02]">
                      <MemberControls member={member} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Right: Invite Someone (2 columns on lg) */}
        <section className="space-y-4 lg:col-span-2">
          <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-6 shadow-sm backdrop-blur-md dark:border-white/10 dark:bg-white/5">
            <div className="mb-4">
              <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">Invite someone</h2>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Grant support agent triage permissions or invite a customer account.
              </p>
            </div>

            <div className="mb-5 rounded-xl border border-indigo-100 bg-indigo-50/60 p-3 text-xs text-indigo-900 dark:border-indigo-900/40 dark:bg-indigo-950/30 dark:text-indigo-200">
              <div className="flex items-start gap-2">
                <span className="text-sm">💡</span>
                <span>
                  Invited members will receive a secure email link to set up their password, or you can assign a temporary password manually.
                </span>
              </div>
            </div>

            <InviteForm />
          </div>
        </section>
      </div>
    </div>
  );
}
