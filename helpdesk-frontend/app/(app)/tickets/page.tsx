import Link from 'next/link';
import { Suspense } from 'react';
import { PriorityBadge, StatusBadge } from '@/components/badges';
import { LiveRefresh } from '@/components/live-refresh';
import { LocalTime } from '@/components/local-time';
import { api } from '@/lib/api';
import { getCurrentUser } from '@/lib/auth';
import { TICKET_PRIORITIES, TICKET_STATUSES, isStaff } from '@/lib/constants';
import type { TeamMember, TicketPage } from '@/lib/types';

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

const PAGE_SIZE = 20;
const ASSIGNED = ['me', 'unassigned'] as const;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
/** The one query-string value a filter may carry: a known option, or nothing. */
const pick = <T extends string>(value: string | string[] | undefined, allowed: readonly T[]) =>
  allowed.find((option) => option === first(value));

export default function TicketsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<p className="text-sm text-neutral-600 dark:text-neutral-400">Loading tickets…</p>}>
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
  const assigned = staff ? pick(params.assigned, ASSIGNED) : undefined;
  const breached = staff && first(params.breached) === 'true';
  const q = (first(params.q) ?? '').trim().slice(0, 100);
  const requested = Number(first(params.page));
  const page = Number.isInteger(requested) && requested >= 1 ? requested : 1;

  const filters = new URLSearchParams();
  if (status) filters.set('status', status);
  if (priority) filters.set('priority', priority);
  if (assigned) filters.set('assigned', assigned);
  if (breached) filters.set('breached', 'true');
  if (q) filters.set('q', q);

  const query = new URLSearchParams(filters);
  query.set('page', String(page));
  query.set('limit', String(PAGE_SIZE));
  const [data, online, team] = await Promise.all([
    api<TicketPage>(`/api/v1/tickets?${query}`),
    staff ? api<{ userId: string; email: string }[]>('/api/v1/presence') : Promise.resolve([]),
    staff ? api<TeamMember[]>('/api/v1/team') : Promise.resolve([]),
  ]);
  const people = new Map(team.map((member) => [member.userId, member.email]));

  const lastPage = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const pageHref = (target: number) => {
    const next = new URLSearchParams(filters);
    next.set('page', String(target));
    return `/tickets?${next}`;
  };
  const filtered = filters.size > 0;
  const selectClass = 'rounded-md border border-neutral-300 bg-transparent px-2 py-1.5 text-sm dark:border-neutral-700';

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

      {staff && (
        <p className="text-sm text-neutral-600 dark:text-neutral-400" data-testid="online-staff">
          Online now: {online.length ? online.map((person) => person.email).join(', ') : 'nobody'}
        </p>
      )}

      {/* A plain GET form: choosing filters just reloads this page with a new query string. */}
      <form className="flex flex-wrap items-center gap-2" action="/tickets">
        <input
          name="q"
          type="search"
          defaultValue={q}
          placeholder="Search subjects…"
          aria-label="Search subjects"
          maxLength={100}
          className={`${selectClass} w-44`}
        />
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
        {staff && (
          <>
            <select name="assigned" defaultValue={assigned ?? ''} aria-label="Filter by assignee" className={selectClass}>
              <option value="">Anyone</option>
              <option value="me">Assigned to me</option>
              <option value="unassigned">Unassigned</option>
            </select>
            <label className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" name="breached" value="true" defaultChecked={breached} />
              SLA breached
            </label>
          </>
        )}
        <button type="submit" className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700">
          Filter
        </button>
        {filtered && (
          <Link href="/tickets" className="text-sm text-blue-600 dark:text-blue-400 hover:underline">
            Clear
          </Link>
        )}
      </form>

      {data.items.length === 0 ? (
        <p className="rounded-md border border-dashed border-neutral-300 px-4 py-10 text-center text-sm text-neutral-600 dark:text-neutral-400 dark:border-neutral-700">
          {filtered ? 'No tickets match these filters.' : staff ? 'The queue is empty.' : 'You have not raised any tickets yet.'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-neutral-50 text-xs uppercase text-neutral-600 dark:text-neutral-400 dark:bg-neutral-900">
              <tr>
                <th className="px-4 py-2 font-medium">Subject</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Priority</th>
                {staff && <th className="px-4 py-2 font-medium">Assignee</th>}
                {staff && <th className="px-4 py-2 font-medium">SLA deadline</th>}
                <th className="px-4 py-2 font-medium">Opened</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
              {data.items.map((ticket) => (
                <tr key={ticket.id}>
                  <td className="px-4 py-2 [overflow-wrap:anywhere]">
                    <Link href={`/tickets/${ticket.id}`} className="font-medium text-blue-600 dark:text-blue-400 hover:underline">
                      {ticket.subject}
                    </Link>
                  </td>
                  <td className="px-4 py-2">
                    <StatusBadge status={ticket.status} />
                  </td>
                  <td className="px-4 py-2">
                    <PriorityBadge priority={ticket.priority} />
                  </td>
                  {staff && (
                    <td className="px-4 py-2 whitespace-nowrap">
                      {ticket.agentId ? (people.get(ticket.agentId) ?? 'Unknown') : <span className="text-neutral-600 dark:text-neutral-400">Unassigned</span>}
                    </td>
                  )}
                  {staff && (
                    <td className="px-4 py-2 whitespace-nowrap">
                      <LocalTime iso={ticket.slaDeadline} />
                      {ticket.slaBreachedAt && (
                        <span className="ml-2 rounded-full bg-red-600 px-2 py-0.5 text-xs font-medium text-white">Breached</span>
                      )}
                    </td>
                  )}
                  <td className="px-4 py-2 whitespace-nowrap">
                    <LocalTime iso={ticket.createdAt} />
                  </td>
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
            <Link href={pageHref(page - 1)} className="text-blue-600 dark:text-blue-400 hover:underline">
              ← Previous
            </Link>
          )}
          {page < lastPage && (
            <Link href={pageHref(page + 1)} className="text-blue-600 dark:text-blue-400 hover:underline">
              Next →
            </Link>
          )}
        </span>
      </div>
    </div>
  );
}
