import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { CommentForm } from '@/components/forms';
import { LiveTicket } from '@/components/live-ticket';
import { ApiError, api } from '@/lib/api';
import { getCurrentUser } from '@/lib/auth';
import { isStaff } from '@/lib/constants';
import type { CannedResponse, TeamMember, Ticket, TicketComment } from '@/lib/types';

export default function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-16 text-sm text-slate-500 dark:text-slate-400">
          <div className="flex items-center gap-2">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
            Loading ticket…
          </div>
        </div>
      }
    >
      <TicketDetail params={params} />
    </Suspense>
  );
}

async function TicketDetail({ params }: { params: Promise<{ id: string }> }) {
  const [user, { id }] = await Promise.all([getCurrentUser(), params]);
  const staff = isStaff(user.role);

  let ticket: Ticket;
  let comments: TicketComment[];
  // Staff also need the people a ticket can be assigned to and the canned replies (customers get neither).
  const [team, canned] = staff
    ? await Promise.all([api<TeamMember[]>('/api/v1/team'), api<CannedResponse[]>('/api/v1/canned-responses')])
    : [[], []];
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

  return (
    <div className="space-y-6">
      {/* Back navigation */}
      <div>
        <Link
          href="/tickets"
          className="inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-indigo-600 transition hover:text-indigo-700 hover:underline dark:text-indigo-400 dark:hover:text-indigo-300"
        >
          ← Back to {staff ? 'queue' : 'my tickets'}
        </Link>
      </div>

      {/* Ticket Subject Title */}
      <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-6 shadow-sm backdrop-blur-md dark:border-white/10 dark:bg-white/5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Ticket #{ticket.id.slice(0, 8)}
            </span>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 [overflow-wrap:anywhere] dark:text-white sm:text-3xl">
              {ticket.subject}
            </h1>
          </div>
        </div>
      </div>

      {/* Server-rendered with today's data; the socket keeps it current from here on. */}
      <LiveTicket
        ticket={ticket}
        comments={comments}
        viewer={{ userId: user.userId, role: user.role }}
        team={team.filter((member) => member.role !== 'CUSTOMER')}
      />

      {/* Reply Section */}
      <section className="space-y-4 rounded-2xl border border-slate-200/80 bg-white/80 p-6 shadow-sm backdrop-blur-md dark:border-white/10 dark:bg-white/5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">Reply</h2>
          {staff && (
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Markdown supported · Real-time socket delivery
            </span>
          )}
        </div>
        <CommentForm ticketId={ticket.id} canWriteInternalNote={staff} canned={canned} />
      </section>
    </div>
  );
}
