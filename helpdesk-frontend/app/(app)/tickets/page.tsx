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
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-16 text-sm text-slate-500 dark:text-slate-400">
          <div className="flex items-center gap-2">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
            Loading tickets…
          </div>
        </div>
      }
    >
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

  const filterSelectClass =
    'cursor-pointer appearance-none rounded-xl border border-slate-200/90 bg-white/90 pl-3 pr-8 py-2 text-sm font-medium shadow-xs outline-none transition hover:border-slate-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-white/10 dark:bg-white/5 dark:hover:border-white/20';

  return (
    <div className="space-y-6">
      {staff && <LiveRefresh />}

      {/* Header bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              {staff ? 'Ticket queue' : 'My tickets'}
            </h1>
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700 dark:bg-white/10 dark:text-slate-300">
              {data.total} {data.total === 1 ? 'ticket' : 'tickets'}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {staff
              ? 'Triage, assign, and track customer support requests with real-time sync.'
              : 'View status updates, responses, and raise new requests with our support team.'}
          </p>
        </div>

        {user.role === 'CUSTOMER' && (
          <Link
            href="/tickets/new"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-indigo-600/25 transition-all duration-150 hover:from-indigo-500 hover:to-violet-500 active:scale-[0.98]"
          >
            <span>+</span>
            <span>New ticket</span>
          </Link>
        )}
      </div>

      {/* Staff live presence banner */}
      {staff && (
        <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200/60 bg-emerald-50/50 px-4 py-2.5 text-sm text-emerald-900 shadow-xs backdrop-blur-sm dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-200">
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
          </span>
          <p className="text-sm font-medium [overflow-wrap:anywhere]" data-testid="online-staff">
            Online now: {online.length ? online.map((person) => person.email).join(', ') : 'nobody'}
          </p>
        </div>
      )}

      {/* Modern Filter Toolbar */}
      <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 shadow-sm backdrop-blur-md dark:border-white/10 dark:bg-white/5">
        <form className="flex flex-wrap items-center gap-2.5" action="/tickets">
          <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <input
              name="q"
              type="search"
              defaultValue={q}
              placeholder="Search subjects…"
              aria-label="Search subjects"
              maxLength={100}
              className="w-full rounded-xl border border-slate-200/90 bg-white/90 px-3.5 py-2 text-sm shadow-xs outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-white/10 dark:bg-white/5 dark:hover:border-white/20"
            />
          </div>

          <select
            name="status"
            defaultValue={status ?? ''}
            aria-label="Filter by status"
            className={`${filterSelectClass} max-w-[160px]`}
          >
            <option value="">All statuses</option>
            {TICKET_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace('_', ' ')}
              </option>
            ))}
          </select>

          <select
            name="priority"
            defaultValue={priority ?? ''}
            aria-label="Filter by priority"
            className={`${filterSelectClass} max-w-[160px]`}
          >
            <option value="">All priorities</option>
            {TICKET_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>

          {staff && (
            <>
              <select
                name="assigned"
                defaultValue={assigned ?? ''}
                aria-label="Filter by assignee"
                className={`${filterSelectClass} max-w-[170px]`}
              >
                <option value="">Anyone</option>
                <option value="me">Assigned to me</option>
                <option value="unassigned">Unassigned</option>
              </select>

              <label className="flex cursor-pointer select-none items-center gap-2 rounded-xl border border-slate-200/90 bg-white/90 px-3 py-2 text-sm font-medium shadow-xs transition hover:border-slate-300 dark:border-white/10 dark:bg-white/5">
                <input
                  type="checkbox"
                  name="breached"
                  value="true"
                  defaultChecked={breached}
                  className="rounded border-slate-300 text-red-600 focus:ring-red-500 dark:border-white/20"
                />
                <span className="text-slate-700 dark:text-slate-300">SLA breached</span>
              </label>
            </>
          )}

          <button
            type="submit"
            className="inline-flex cursor-pointer items-center justify-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-xs transition hover:bg-slate-800 active:scale-[0.98] dark:bg-white/15 dark:text-white dark:hover:bg-white/25"
          >
            Filter
          </button>

          {filtered && (
            <Link
              href="/tickets"
              className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 transition hover:text-indigo-700 hover:underline dark:text-indigo-400 dark:hover:text-indigo-300"
            >
              Clear
            </Link>
          )}
        </form>
      </div>

      {/* Ticket List / Table */}
      {data.items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300/80 bg-white/40 px-6 py-16 text-center dark:border-white/10 dark:bg-white/5">
          <div className="grid h-12 w-12 place-items-center rounded-full bg-slate-100 dark:bg-white/10">
            <span className="text-xl">📋</span>
          </div>
          <p className="mt-3 text-sm font-medium text-slate-600 dark:text-slate-400">
            {filtered ? 'No tickets match these filters.' : staff ? 'The queue is empty.' : 'You have not raised any tickets yet.'}
          </p>
          {filtered ? (
            <Link href="/tickets" className="mt-2 text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400">
              Reset search and filters
            </Link>
          ) : user.role === 'CUSTOMER' ? (
            <Link href="/tickets/new" className="mt-3 text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400">
              Create your first ticket →
            </Link>
          ) : null}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200/80 bg-white/80 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/5">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200/80 bg-slate-50/80 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-400">
              <tr>
                <th className="px-5 py-3.5">Subject</th>
                <th className="px-4 py-3.5">Status</th>
                <th className="px-4 py-3.5">Priority</th>
                {staff && <th className="px-4 py-3.5">Assignee</th>}
                {staff && <th className="px-4 py-3.5">SLA deadline</th>}
                <th className="px-4 py-3.5">Opened</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/10 [&_tr]:transition-colors [&_tr:hover]:bg-indigo-50/50 dark:[&_tr:hover]:bg-white/5">
              {data.items.map((ticket) => (
                <tr key={ticket.id} className="group">
                  <td className="px-5 py-3.5 [overflow-wrap:anywhere]">
                    <Link
                      href={`/tickets/${ticket.id}`}
                      className="font-semibold text-slate-900 transition hover:text-indigo-600 dark:text-slate-100 dark:hover:text-indigo-400"
                    >
                      {ticket.subject}
                    </Link>
                  </td>
                  <td className="px-4 py-3.5 whitespace-nowrap">
                    <StatusBadge status={ticket.status} />
                  </td>
                  <td className="px-4 py-3.5 whitespace-nowrap">
                    <PriorityBadge priority={ticket.priority} />
                  </td>
                  {staff && (
                    <td className="px-4 py-3.5 whitespace-nowrap text-xs">
                      {ticket.agentId ? (
                        <span className="inline-flex items-center gap-1.5 font-medium text-slate-700 dark:text-slate-300">
                          <span className="grid h-5 w-5 place-items-center rounded-full bg-indigo-100 text-[10px] font-bold text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-300">
                            {(people.get(ticket.agentId) ?? 'U').charAt(0).toUpperCase()}
                          </span>
                          {people.get(ticket.agentId) ?? 'Unknown'}
                        </span>
                      ) : (
                        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 dark:bg-white/10 dark:text-slate-300">
                          Unassigned
                        </span>
                      )}
                    </td>
                  )}
                  {staff && (
                    <td className="px-4 py-3.5 whitespace-nowrap text-xs">
                      <LocalTime iso={ticket.slaDeadline} />
                      {ticket.slaBreachedAt && (
                        <span className="ml-2 inline-flex items-center rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-semibold text-white shadow-xs shadow-red-600/30">
                          Breached
                        </span>
                      )}
                    </td>
                  )}
                  <td className="px-4 py-3.5 whitespace-nowrap text-xs text-slate-500 dark:text-slate-400">
                    <LocalTime iso={ticket.createdAt} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination Footer */}
      <div className="flex flex-col items-center justify-between gap-3 text-sm text-slate-600 sm:flex-row dark:text-slate-400">
        <span className="font-medium">
          {data.total} {data.total === 1 ? 'ticket' : 'tickets'}
          {lastPage > 1 && ` · page ${page} of ${lastPage}`}
        </span>
        <div className="flex items-center gap-3">
          {page > 1 ? (
            <Link
              href={pageHref(page - 1)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-semibold text-indigo-600 shadow-xs transition hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-indigo-400 dark:hover:bg-white/10"
            >
              ← Previous
            </Link>
          ) : (
            <span className="cursor-not-allowed rounded-lg border border-slate-100 px-3 py-1.5 text-slate-300 dark:border-white/5 dark:text-slate-600">
              ← Previous
            </span>
          )}

          {page < lastPage ? (
            <Link
              href={pageHref(page + 1)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-semibold text-indigo-600 shadow-xs transition hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-indigo-400 dark:hover:bg-white/10"
            >
              Next →
            </Link>
          ) : (
            <span className="cursor-not-allowed rounded-lg border border-slate-100 px-3 py-1.5 text-slate-300 dark:border-white/5 dark:text-slate-600">
              Next →
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
