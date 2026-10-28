import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LocalTime } from '@/components/local-time';
import { ApiError } from '@/lib/api';
import { platformApi } from '@/lib/platform';
import type { PlatformTicket } from '@/lib/platform';

// Read-only. Opening this page is itself written to the platform audit log (by the API).
export default async function PlatformTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let ticket: PlatformTicket;
  try {
    ticket = await platformApi<PlatformTicket>(`/tickets/${id}`);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 400)) notFound();
    throw err;
  }

  return (
    <div className="space-y-6 pb-12">
      {/* Back link */}
      <div>
        <Link
          href={`/platform/organizations/${ticket.orgId}`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 transition hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-400"
        >
          <span>← {ticket.organisation}</span>
        </Link>
      </div>

      {/* Ticket Header */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-3xl [overflow-wrap:anywhere]">
            {ticket.subject}
          </h1>
          {ticket.slaBreached && (
            <span className="inline-flex items-center rounded-full bg-rose-600 px-2.5 py-0.5 text-xs font-semibold text-white shadow-sm">
              SLA breached
            </span>
          )}
        </div>

        {/* Metadata pills */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-lg border border-slate-200 bg-slate-100 px-2.5 py-1 font-semibold text-slate-700 dark:border-white/10 dark:bg-white/10 dark:text-slate-300">
            {ticket.status}
          </span>
          <span className="rounded-lg border border-slate-200 bg-slate-100 px-2.5 py-1 font-semibold text-slate-700 dark:border-white/10 dark:bg-white/10 dark:text-slate-300">
            {ticket.priority}
          </span>
          <span className="rounded-lg border border-slate-200/80 bg-white/70 px-2.5 py-1 text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-400">
            Requester: <strong className="text-slate-900 dark:text-white">{ticket.requester}</strong>
          </span>
          <span className="rounded-lg border border-slate-200/80 bg-white/70 px-2.5 py-1 text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-400">
            Assigned: <strong className="text-slate-900 dark:text-white">{ticket.assignedTo ?? 'Unassigned'}</strong>
          </span>
          <span className="rounded-lg border border-slate-200/80 bg-white/70 px-2.5 py-1 text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-400">
            Opened: <LocalTime iso={ticket.createdAt} />
          </span>
        </div>
      </div>

      {/* Privileged Notice */}
      <div className="flex items-start gap-3 rounded-2xl border border-amber-400/40 bg-amber-50/80 p-4 shadow-sm backdrop-blur-xl dark:border-amber-500/30 dark:bg-amber-950/40">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-amber-500/20 text-amber-700 dark:text-amber-300">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <p className="text-xs leading-relaxed font-medium text-amber-900 dark:text-amber-200">
          You are viewing another organisation&apos;s private conversation, including internal notes. This view has been recorded in the platform audit log.
        </p>
      </div>

      {/* Conversation Thread */}
      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-slate-900 uppercase tracking-wider dark:text-white">
          Conversation History ({ticket.comments.length})
        </h2>
        <ul className="space-y-3.5">
          {ticket.comments.map((comment) => (
            <li
              key={comment.id}
              className={`rounded-2xl p-5 shadow-sm backdrop-blur-xl transition [overflow-wrap:anywhere] ${
                comment.isInternalNote
                  ? 'border-2 border-dashed border-amber-400/80 bg-amber-50/70 dark:border-amber-700/60 dark:bg-amber-950/30'
                  : 'border border-slate-200/80 bg-white/80 dark:border-white/10 dark:bg-slate-900/60'
              }`}
            >
              <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2">
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-200 font-bold text-slate-700 dark:bg-white/10 dark:text-slate-300">
                    {comment.author.slice(0, 1).toUpperCase()}
                  </div>
                  <span className="font-semibold text-slate-900 dark:text-white">{comment.author}</span>
                  <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600 dark:bg-white/10 dark:text-slate-300">
                    {comment.authorRole.toLowerCase()}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                  <LocalTime iso={comment.createdAt} />
                  {comment.isInternalNote && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-200/80 px-2 py-0.5 font-semibold text-amber-900 dark:bg-amber-900/60 dark:text-amber-200">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                      </svg>
                      Internal note
                    </span>
                  )}
                </div>
              </div>
              <p className="text-sm leading-relaxed whitespace-pre-wrap text-slate-800 dark:text-slate-200">
                {comment.message}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

