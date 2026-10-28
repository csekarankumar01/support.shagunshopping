import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LocalTime } from '@/components/local-time';
import { OrganizationForm, SuspendControls, UserControls } from '@/components/platform-forms';
import { ApiError } from '@/lib/api';
import { platformApi } from '@/lib/platform';
import type { PlatformOrg, PlatformTicketRow, PlatformUser } from '@/lib/platform';

const card =
  'space-y-4 rounded-2xl border border-slate-200/80 bg-white/80 p-6 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/60';

export default async function OrganizationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let org: PlatformOrg;
  let users: PlatformUser[];
  let tickets: { items: PlatformTicketRow[]; total: number };
  try {
    [org, users, tickets] = await Promise.all([
      platformApi<PlatformOrg>(`/organizations/${id}`),
      platformApi<PlatformUser[]>(`/organizations/${id}/users`),
      platformApi<{ items: PlatformTicketRow[]; total: number }>(`/organizations/${id}/tickets?limit=20`),
    ]);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 400)) notFound();
    throw err;
  }

  return (
    <div className="space-y-8 pb-12">
      {/* Navigation & Header */}
      <div className="space-y-4">
        <Link
          href="/platform/organizations"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 transition hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-400"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          <span>All organisations</span>
        </Link>

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-tr from-indigo-600 via-purple-600 to-cyan-500 text-lg font-bold text-white shadow-md shadow-indigo-500/20">
              {org.name.slice(0, 1).toUpperCase()}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-3xl [overflow-wrap:anywhere]">
                  {org.name}
                </h1>
                <span className="font-mono text-xs rounded-md bg-slate-100 px-2 py-0.5 text-slate-600 dark:bg-white/10 dark:text-slate-300">
                  {org.slug}
                </span>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                    org.status === 'ACTIVE'
                      ? 'border border-emerald-500/30 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                      : 'border border-rose-500/30 bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300'
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${org.status === 'ACTIVE' ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                  {org.status}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Created <LocalTime iso={org.createdAt} /> · SLA: {org.slaMins} minutes to first reply
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Configuration & Controls */}
      <div className="grid gap-6 md:grid-cols-2">
        <section className={card}>
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3 dark:border-white/10">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">Details</h2>
          </div>
          <OrganizationForm org={org} />
        </section>

        <section className={`${card} ${org.status === 'SUSPENDED' ? 'border-rose-300 bg-rose-50/40 dark:border-rose-900/40 dark:bg-rose-950/20' : ''}`}>
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3 dark:border-white/10">
            <div className={`flex h-7 w-7 items-center justify-center rounded-lg ${org.status === 'ACTIVE' ? 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400' : 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400'}`}>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              {org.status === 'ACTIVE' ? 'Suspend' : 'Suspension'}
            </h2>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Suspending signs everyone in this organisation out immediately and blocks sign-in. Data remains preserved.
          </p>
          <SuspendControls org={org} />
        </section>
      </div>

      {/* People section */}
      <section className="space-y-3.5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">
            People ({users.length})
          </h2>
          <span className="text-xs text-slate-500 dark:text-slate-400">Tenant membership directory</span>
        </div>
        <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/80 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/60">
          <ul className="divide-y divide-slate-100 dark:divide-white/5">
            {users.map((user) => (
              <li key={user.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 text-sm transition hover:bg-slate-50/50 dark:hover:bg-white/[0.02]">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-xs font-semibold text-slate-700 dark:bg-white/10 dark:text-slate-300">
                    {user.email.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <span className={`font-medium [overflow-wrap:anywhere] ${user.isActive ? 'text-slate-900 dark:text-white' : 'text-slate-400 line-through'}`}>
                      {user.email}
                    </span>
                    {!user.isActive && (
                      <span className="ml-2 inline-flex items-center rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-800 no-underline dark:bg-rose-950 dark:text-rose-300">
                        Deactivated
                      </span>
                    )}
                  </div>
                </div>
                <UserControls orgId={org.id} user={user} />
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Recent tickets section */}
      <section className="space-y-3.5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">
            Recent tickets ({tickets.total}){' '}
            <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
              · opening one is recorded in the platform audit log
            </span>
          </h2>
        </div>
        {tickets.items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white/40 p-8 text-center backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/40 text-sm text-slate-500 dark:text-slate-400">
            No tickets have been raised for this organisation yet.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-200/80 bg-white/80 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/60">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200/80 bg-slate-50/80 text-xs font-semibold tracking-wider text-slate-500 uppercase dark:border-white/10 dark:bg-white/5 dark:text-slate-400">
                <tr>
                  <th className="px-5 py-3.5">Subject</th>
                  <th className="px-4 py-3.5">Status</th>
                  <th className="px-4 py-3.5">Priority</th>
                  <th className="px-4 py-3.5">Requester</th>
                  <th className="px-5 py-3.5">Opened</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5 [&_tr]:transition-colors [&_tr:hover]:bg-indigo-50/40 dark:[&_tr:hover]:bg-white/[0.03]">
                {tickets.items.map((ticket) => (
                  <tr key={ticket.id}>
                    <td className="px-5 py-3.5 [overflow-wrap:anywhere]">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/platform/tickets/${ticket.id}`}
                          className="font-medium text-indigo-600 transition hover:underline dark:text-indigo-400"
                        >
                          {ticket.subject}
                        </Link>
                        {ticket.slaBreached && (
                          <span className="inline-flex items-center rounded-full bg-rose-600 px-2 py-0.5 text-xs font-medium text-white shadow-sm">
                            Breached
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 dark:bg-white/10 dark:text-slate-300">
                        {ticket.status}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 dark:bg-white/10 dark:text-slate-300">
                        {ticket.priority}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 [overflow-wrap:anywhere] text-xs text-slate-600 dark:text-slate-300">
                      {ticket.requester}
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap text-xs text-slate-500 dark:text-slate-400">
                      <LocalTime iso={ticket.createdAt} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

