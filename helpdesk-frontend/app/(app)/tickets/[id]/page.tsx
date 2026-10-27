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
    <Suspense fallback={<p className="text-sm text-neutral-600 dark:text-neutral-400">Loading ticket…</p>}>
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
      <Link href="/tickets" className="text-sm text-blue-600 dark:text-blue-400 hover:underline">
        ← Back to {staff ? 'queue' : 'my tickets'}
      </Link>

      <h1 className="text-xl font-semibold [overflow-wrap:anywhere]">{ticket.subject}</h1>

      {/* Server-rendered with today's data; the socket keeps it current from here on. */}
      <LiveTicket
        ticket={ticket}
        comments={comments}
        viewer={{ userId: user.userId, role: user.role }}
        team={team.filter((member) => member.role !== 'CUSTOMER')}
      />

      <section className="space-y-3">
        <h2 className="font-medium">Reply</h2>
        <CommentForm ticketId={ticket.id} canWriteInternalNote={staff} canned={canned} />
      </section>
    </div>
  );
}
