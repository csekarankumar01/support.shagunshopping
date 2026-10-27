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
    <div className="space-y-5">
      <Link href={`/platform/organizations/${ticket.orgId}`} className="text-sm text-indigo-600 hover:underline dark:text-indigo-400">
        ← {ticket.organisation}
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight [overflow-wrap:anywhere]">{ticket.subject}</h1>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-neutral-600 dark:text-neutral-400">
        <span>{ticket.status}</span>
        <span>{ticket.priority}</span>
        <span>From {ticket.requester}</span>
        <span>Assigned to {ticket.assignedTo ?? 'nobody'}</span>
        <span>
          Opened <LocalTime iso={ticket.createdAt} />
        </span>
        {ticket.slaBreached && <span className="font-medium text-red-600 dark:text-red-400">SLA breached</span>}
      </p>
      <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
        You are viewing another organisation&apos;s private conversation, including internal notes. This view has been recorded.
      </p>
      <ul className="space-y-3">
        {ticket.comments.map((comment) => (
          <li
            key={comment.id}
            className={`rounded-2xl px-4 py-3 [overflow-wrap:anywhere] ${comment.isInternalNote ? 'border border-dashed border-amber-400 bg-amber-50 dark:border-amber-800 dark:bg-amber-950' : 'border border-slate-200/80 bg-white/80 shadow-sm dark:border-white/10 dark:bg-white/5'}`}
          >
            <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-neutral-600 dark:text-neutral-400">
              <span className="font-medium">{comment.author}</span>
              <span>({comment.authorRole.toLowerCase()})</span>
              <LocalTime iso={comment.createdAt} />
              {comment.isInternalNote && <span className="rounded-full bg-amber-200 px-2 py-0.5 font-medium text-amber-900 dark:bg-amber-800 dark:text-amber-100">Internal note</span>}
            </div>
            <p className="text-sm whitespace-pre-wrap">{comment.message}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
