import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { PriorityBadge, StatusBadge } from '@/components/badges';
import { CommentForm, StatusForm } from '@/components/forms';
import { ApiError, api } from '@/lib/api';
import { getCurrentUser } from '@/lib/auth';
import { isStaff } from '@/lib/constants';
import { formatDate } from '@/lib/format';
import type { Ticket, TicketComment } from '@/lib/types';

export default function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<p className="text-sm text-neutral-500">Loading ticket…</p>}>
      <TicketDetail params={params} />
    </Suspense>
  );
}

async function TicketDetail({ params }: { params: Promise<{ id: string }> }) {
  const [user, { id }] = await Promise.all([getCurrentUser(), params]);
  const staff = isStaff(user.role);

  let ticket: Ticket;
  let comments: TicketComment[];
  try {
    // The API answers 404 for a ticket in another organisation (or another customer's ticket),
    // exactly as it does for one that does not exist, so this page cannot be used to probe ids.
    [ticket, comments] = await Promise.all([
      api<Ticket>(`/api/v1/tickets/${id}`),
      api<TicketComment[]>(`/api/v1/tickets/${id}/comments`),
    ]);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 400)) notFound();
    throw err;
  }

  // Comments carry only an author id, so the label is worked out from who the viewer is.
  const authorLabel = (authorId: string) => {
    if (authorId === user.userId) return 'You';
    return authorId === ticket.requesterId ? 'Customer' : 'Support';
  };

  return (
    <div className="space-y-6">
      <Link href="/tickets" className="text-sm text-blue-600 hover:underline">
        ← Back to {staff ? 'queue' : 'my tickets'}
      </Link>

      <div className="space-y-3">
        <h1 className="text-xl font-semibold">{ticket.subject}</h1>
        <div className="flex flex-wrap items-center gap-3 text-sm text-neutral-600 dark:text-neutral-400">
          <StatusBadge status={ticket.status} />
          <PriorityBadge priority={ticket.priority} />
          <span>Opened {formatDate(ticket.createdAt)}</span>
          {staff && <span>SLA deadline {formatDate(ticket.slaDeadline)}</span>}
        </div>
        {staff && <StatusForm ticketId={ticket.id} current={ticket.status} />}
      </div>

      <section className="space-y-3">
        <h2 className="font-medium">Conversation</h2>
        {comments.length === 0 ? (
          <p className="text-sm text-neutral-500">No messages yet.</p>
        ) : (
          <ul className="space-y-3">
            {comments.map((comment) => (
              <li
                key={comment.id}
                className={
                  comment.isInternalNote
                    ? 'rounded-md border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950'
                    : 'rounded-md border border-neutral-200 px-4 py-3 dark:border-neutral-800'
                }
              >
                <div className="mb-1 flex items-center gap-2 text-xs text-neutral-500">
                  <span className="font-medium">{authorLabel(comment.authorId)}</span>
                  <span>{formatDate(comment.createdAt)}</span>
                  {comment.isInternalNote && (
                    <span className="rounded-full bg-amber-200 px-2 py-0.5 font-medium text-amber-900 dark:bg-amber-800 dark:text-amber-100">
                      Internal note
                    </span>
                  )}
                </div>
                <p className="text-sm whitespace-pre-wrap">{comment.message}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">Reply</h2>
        <CommentForm ticketId={ticket.id} canWriteInternalNote={staff} />
      </section>
    </div>
  );
}
