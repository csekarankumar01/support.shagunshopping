import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LocalTime } from '@/components/local-time';
import { OrganizationForm, SuspendControls, UserControls } from '@/components/platform-forms';
import { ApiError } from '@/lib/api';
import { platformApi } from '@/lib/platform';
import type { PlatformOrg, PlatformTicketRow, PlatformUser } from '@/lib/platform';

const card =
  'space-y-4 rounded-2xl border border-slate-200/80 bg-white/80 p-5 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/5';

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
    <div className="space-y-6">
      <Link href="/platform/organizations" className="text-sm text-indigo-600 hover:underline dark:text-indigo-400">
        ← All organisations
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight [overflow-wrap:anywhere]">{org.name}</h1>
        <span className="text-sm text-slate-500 dark:text-slate-400">{org.slug}</span>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${org.status === 'ACTIVE' ? 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300' : 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'}`}
        >
          {org.status}
        </span>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <section className={card}>
          <h2 className="font-medium">Details</h2>
          <OrganizationForm org={org} />
        </section>
        <section className={card}>
          <h2 className="font-medium">{org.status === 'ACTIVE' ? 'Suspend' : 'Suspension'}</h2>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            Suspending signs everyone in this organisation out and blocks sign-in. Nothing is deleted.
          </p>
          <SuspendControls org={org} />
        </section>
      </div>

      <section className="space-y-3">
        <h2 className="font-medium">People ({users.length})</h2>
        <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200/80 bg-white/80 shadow-sm dark:divide-white/10 dark:border-white/10 dark:bg-white/5">
          {users.map((user) => (
            <li key={user.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <span className={`[overflow-wrap:anywhere] ${user.isActive ? '' : 'text-neutral-500 line-through'}`}>
                {user.email}
                {!user.isActive && <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-800 no-underline dark:bg-red-950 dark:text-red-300">Deactivated</span>}
              </span>
              <UserControls orgId={org.id} user={user} />
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">
          Recent tickets ({tickets.total}) <span className="text-xs font-normal text-slate-500">opening one is recorded in the audit log</span>
        </h2>
        {tickets.items.length === 0 ? (
          <p className="text-sm text-neutral-600 dark:text-neutral-400">No tickets yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-200/80 bg-white/80 shadow-sm dark:border-white/10 dark:bg-white/5">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50/80 text-xs tracking-wide text-slate-500 uppercase dark:bg-white/5 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-2 font-medium">Subject</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Priority</th>
                  <th className="px-4 py-2 font-medium">Requester</th>
                  <th className="px-4 py-2 font-medium">Opened</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/10">
                {tickets.items.map((ticket) => (
                  <tr key={ticket.id}>
                    <td className="px-4 py-2 [overflow-wrap:anywhere]">
                      <Link href={`/platform/tickets/${ticket.id}`} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                        {ticket.subject}
                      </Link>
                      {ticket.slaBreached && <span className="ml-2 rounded-full bg-red-600 px-2 py-0.5 text-xs font-medium text-white">Breached</span>}
                    </td>
                    <td className="px-4 py-2">{ticket.status}</td>
                    <td className="px-4 py-2">{ticket.priority}</td>
                    <td className="px-4 py-2 [overflow-wrap:anywhere]">{ticket.requester}</td>
                    <td className="px-4 py-2 whitespace-nowrap">
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
