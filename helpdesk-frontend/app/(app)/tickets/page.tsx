import Link from 'next/link';
import { Suspense } from 'react';
import { PriorityBadge, StatusBadge } from '@/components/badges';
import { LiveRefresh } from '@/components/live-refresh';
import { LocalTime } from '@/components/local-time';
import { api } from '@/lib/api';
import { getCurrentUser } from '@/lib/auth';
import { TICKET_PRIORITIES, TICKET_STATUSES, isStaff } from '@/lib/constants';
import type { TicketPage } from '@/lib/types';

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

const PAGE_SIZE = 20;

/** The one query-string value a filter may carry: a known option, or nothing. */
const pick = <T extends string>(value: string | string[] | undefined, allowed: readonly T[]) =>
  allowed.find((option) => option === value);

export default function TicketsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<p className="text-sm text-neutral-500">Loading tickets…</p>}>
      <TicketList searchParams={searchParams} />
    </Suspense>
  );
}

async function TicketList({ searchParams }: { searchParams: SearchParams }) {
  const [user, params] = await Promise.all([getCurrentUser(), searchParams]);
  const staff = isStaff(user.role);

  // Values are checked against the known lists before they are forwarded, so a hand-edited URL
  // cannot make the API answer 400.
  const status = pick(params.status, TICKET_STATUSES);
  const priority = pick(params.priority, TICKET_PRIORITIES);
  const requested = Number(Array.isArray(params.page) ? params.page[0] : params.page);
  const page = Number.isInteger(requested) && requested >= 1 ? requested : 1;

  const query = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
  if (status) query.set('status', status);
  if (priority) query.set('priority', priority);
  const data = await api<TicketPage>(`/api/v1/tickets?${query}`);

  const lastPage = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const pageHref = (target: number) => {
    const next = new URLSearchParams();
    if (status) next.set('status', status);
    if (priority) next.set('priority', priority);
    next.set('page', String(target));
    return `/tickets?${next}`;
  };
  const selectClass =
    'rounded-md border border-neutral-300 bg-transparent px-2 py-1.5 text-sm dark:border-neutral-700';

  return (
    <div className="space-y-5">
      {staff && <LiveRefresh />}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{staff ? 'Ticket queue' : 'My tickets'}</h1>
        {user.role === 'CUSTOMER' && (
          <Link href="/tickets/new" className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
            New ticket
          </Link>
        )}
      </div>

      {/* A plain GET form: choosing filters just reloads this page with a new query string. */}
      <form className="flex flex-wrap items-center gap-2" action="/tickets">
        <select name="status" defaultValue={status ?? ''} aria-label="Filter by status" className={selectClass}>
          <option value="">All statuses</option>
          {TICKET_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace('_', ' ')}
            </option>
          ))}
        </select>
        <select name="priority" defaultValue={priority ?? ''} aria-label="Filter by priority" className={selectClass}>
          <option value="">All priorities</option>
          {TICKET_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <button type="submit" className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700">
          Filter
        </button>
        {(status || priority) && (
          <Link href="/tickets" className="text-sm text-blue-600 hover:underline">
            Clear
          </Link>
        )}
      </form>

      {data.items.length === 0 ? (
        <p className="rounded-md border border-dashed border-neutral-300 px-4 py-10 text-center text-sm text-neutral-500 dark:border-neutral-700">
          {status || priority
            ? 'No tickets match these filters.'
            : staff
              ? 'The queue is empty.'
              : 'You have not raised any tickets yet.'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-neutral-50 text-xs uppercase text-neutral-500 dark:bg-neutral-900">
              <tr>
                <th className="px-4 py-2 font-medium">Subject</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Priority</th>
                {staff && <th className="px-4 py-2 font-medium">SLA deadline</th>}
                <th className="px-4 py-2 font-medium">Opened</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
              {data.items.map((ticket) => (
                <tr key={ticket.id}>
                  <td className="px-4 py-2 [overflow-wrap:anywhere]">
                    <Link href={`/tickets/${ticket.id}`} className="font-medium text-blue-600 hover:underline">
                      {ticket.subject}
                    </Link>
                  </td>
                  <td className="px-4 py-2">
                    <StatusBadge status={ticket.status} />
                  </td>
                  <td className="px-4 py-2">
                    <PriorityBadge priority={ticket.priority} />
                  </td>
                  {staff && <td className="px-4 py-2 whitespace-nowrap"><LocalTime iso={ticket.slaDeadline} /></td>}
                  <td className="px-4 py-2 whitespace-nowrap"><LocalTime iso={ticket.createdAt} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between text-sm text-neutral-600 dark:text-neutral-400">
        <span>
          {data.total} {data.total === 1 ? 'ticket' : 'tickets'}
          {lastPage > 1 && ` · page ${page} of ${lastPage}`}
        </span>
        <span className="flex gap-4">
          {page > 1 && (
            <Link href={pageHref(page - 1)} className="text-blue-600 hover:underline">
              ← Previous
            </Link>
          )}
          {page < lastPage && (
            <Link href={pageHref(page + 1)} className="text-blue-600 hover:underline">
              Next →
            </Link>
          )}
        </span>
      </div>
    </div>
  );
}
