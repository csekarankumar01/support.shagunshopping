'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PriorityBadge, StatusBadge } from '@/components/badges';
import { AssignForm, StatusForm } from '@/components/forms';
import { LocalTime } from '@/components/local-time';
import { isStaff } from '@/lib/constants';
import type { Role, TicketPriority, TicketStatus } from '@/lib/constants';
import { acquireSocket, joinTicket, onReconnect, useConnectionState } from '@/lib/socket';
import type { TeamMember, Ticket, TicketComment, TypingEvent } from '@/lib/types';

interface Viewer {
  userId: string;
  role: Role;
}

interface Typer {
  role: Role;
  isInternalNote: boolean;
}

/**
 * The part of the ticket page that changes while you watch it: status, conversation, "is typing".
 * The server renders it with the data as of the page load; the socket then adds whatever happens next.
 */
export function LiveTicket({
  ticket,
  comments,
  viewer,
  team,
}: {
  ticket: Ticket;
  comments: TicketComment[];
  viewer: Viewer;
  /** Staff of the organisation (empty for customers): who a ticket can be assigned to. */
  team: TeamMember[];
}) {
  const router = useRouter();
  const staff = isStaff(viewer.role);
  const connection = useConnectionState();

  const [liveComments, setLiveComments] = useState<TicketComment[]>([]);
  const [typers, setTypers] = useState<Record<string, Typer>>({});
  const typerTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  // A status pushed over the socket wins until the server hands us a newer one (after a reload or our own change).
  const [liveStatus, setLiveStatus] = useState<TicketStatus | null>(null);
  const [serverStatus, setServerStatus] = useState(ticket.status);
  if (ticket.status !== serverStatus) {
    setServerStatus(ticket.status);
    setLiveStatus(null);
  }
  const status = liveStatus ?? ticket.status;

  // Same idea for the assignee and for an SLA breach (which also raises the priority) pushed to staff.
  const [liveAssignee, setLiveAssignee] = useState<{ id: string | null } | null>(null);
  const [serverAssignee, setServerAssignee] = useState(ticket.agentId);
  if (ticket.agentId !== serverAssignee) {
    setServerAssignee(ticket.agentId);
    setLiveAssignee(null);
  }
  const assigneeId = liveAssignee ? liveAssignee.id : ticket.agentId;
  const [liveBreach, setLiveBreach] = useState<{ priority: TicketPriority } | null>(null);
  const [serverBreach, setServerBreach] = useState(ticket.slaBreachedAt);
  if (ticket.slaBreachedAt !== serverBreach) {
    setServerBreach(ticket.slaBreachedAt);
    setLiveBreach(null);
  }
  const breached = Boolean(ticket.slaBreachedAt) || liveBreach !== null;
  const priority = liveBreach?.priority ?? ticket.priority;
  const assignee = team.find((member) => member.userId === assigneeId);

  useEffect(() => {
    const timers = typerTimers.current;
    const { socket, release } = acquireSocket();
    const leave = joinTicket(ticket.id);

    const forget = (userId: string) => {
      clearTimeout(timers.get(userId));
      timers.delete(userId);
      setTypers((previous) => {
        const next = { ...previous };
        delete next[userId];
        return next;
      });
    };
    const onComment = (comment: TicketComment) => {
      if (comment.ticketId !== ticket.id) return;
      setLiveComments((previous) => (previous.some((c) => c.id === comment.id) ? previous : [...previous, comment]));
      forget(comment.authorId); // they have sent it, so they are no longer typing
    };
    const onStatus = (change: { ticketId: string; status: TicketStatus }) => {
      if (change.ticketId === ticket.id) setLiveStatus(change.status);
    };
    const onAssigned = (change: { ticketId: string; agentId: string | null }) => {
      if (change.ticketId === ticket.id) setLiveAssignee({ id: change.agentId });
    };
    const onBreached = (alert: { ticketId: string; priority: TicketPriority }) => {
      if (alert.ticketId === ticket.id) setLiveBreach({ priority: alert.priority });
    };
    const onTyping = (event: TypingEvent) => {
      if (event.ticketId !== ticket.id || event.userId === viewer.userId) return;
      if (!event.isTyping) return forget(event.userId);
      setTypers((previous) => ({ ...previous, [event.userId]: { role: event.role, isInternalNote: event.isInternalNote } }));
      clearTimeout(timers.get(event.userId));
      // If their "stopped typing" never arrives (closed tab, lost connection), stop showing it anyway.
      timers.set(event.userId, setTimeout(() => forget(event.userId), 5000));
    };

    socket.on('comment:new', onComment);
    socket.on('ticket:status', onStatus);
    socket.on('typing', onTyping);
    socket.on('ticket:assigned', onAssigned);
    socket.on('sla:breached', onBreached);
    const stopReloading = onReconnect(() => router.refresh());
    return () => {
      socket.off('comment:new', onComment);
      socket.off('ticket:status', onStatus);
      socket.off('typing', onTyping);
      socket.off('ticket:assigned', onAssigned);
      socket.off('sla:breached', onBreached);
      stopReloading();
      leave();
      release();
      timers.forEach(clearTimeout);
      timers.clear();
    };
  }, [ticket.id, viewer.userId, router]);

  // Server data and live data merged by id, so a comment that arrives both ways shows once.
  const conversation = useMemo(() => {
    const byId = new Map<string, TicketComment>();
    for (const comment of [...comments, ...liveComments]) if (!byId.has(comment.id)) byId.set(comment.id, comment);
    return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }, [comments, liveComments]);

  // The API sends the author's role always, and their address only when the viewer may see it.
  const authorLabel = (comment: TicketComment) => {
    if (comment.authorId === viewer.userId) return 'You';
    if (comment.authorRole === 'CUSTOMER') return comment.authorEmail ?? 'Customer';
    return comment.authorEmail ? `${comment.authorEmail} (${comment.authorRole.toLowerCase()})` : 'Support';
  };

  const typingText = Object.values(typers)
    .map((typer) =>
      typer.role === 'CUSTOMER'
        ? 'Customer is typing…'
        : !staff
          ? 'Support is typing…'
          : typer.isInternalNote
            ? 'A colleague is writing an internal note…'
            : 'A colleague is typing…',
    )
    .filter((text, index, all) => all.indexOf(text) === index)
    .join(' ');

  return (
    <>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3 text-sm text-neutral-600 dark:text-neutral-400">
          <StatusBadge status={status} />
          <PriorityBadge priority={priority} />
          {staff && breached && (
            <span className="inline-block rounded-full bg-red-600 px-2 py-0.5 text-xs font-medium text-white" data-testid="sla-breached">
              SLA breached
            </span>
          )}
          <span>
            Opened <LocalTime iso={ticket.createdAt} />
          </span>
          {staff && (
            <span>
              SLA deadline <LocalTime iso={ticket.slaDeadline} />
            </span>
          )}
          <span className="ml-auto flex items-center gap-1.5 text-xs" data-connection={connection}>
            <span className={`inline-block h-2 w-2 rounded-full ${connection === 'live' ? 'bg-green-500' : 'bg-amber-500'}`} />
            {connection === 'live' ? 'Live' : 'Reconnecting…'}
          </span>
        </div>
        {staff && (
          <>
            <StatusForm ticketId={ticket.id} current={status} />
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-neutral-600 dark:text-neutral-400" data-testid="assignee">
                Assigned to: {assignee ? assignee.email : 'nobody'}
              </span>
              <AssignForm ticketId={ticket.id} current={assigneeId} staff={team} myId={viewer.userId} />
            </div>
            {ticket.firstResponseAt && (
              <p className="text-xs text-neutral-600 dark:text-neutral-400">
                First reply <LocalTime iso={ticket.firstResponseAt} />
              </p>
            )}
          </>
        )}
      </div>

      <section className="space-y-3">
        <h2 className="font-medium">Conversation</h2>
        {conversation.length === 0 ? (
          <p className="text-sm text-neutral-600 dark:text-neutral-400">No messages yet.</p>
        ) : (
          <ul className="space-y-3">
            {conversation.map((comment) => (
              <li
                key={comment.id}
                className={
                  comment.isInternalNote
                    ? 'rounded-2xl border border-dashed border-amber-400 bg-amber-50 px-4 py-3 [overflow-wrap:anywhere] dark:border-amber-800 dark:bg-amber-950'
                    : 'rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-3 shadow-sm [overflow-wrap:anywhere] dark:border-white/10 dark:bg-white/5'
                }
              >
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-neutral-600 dark:text-neutral-400">
                  <span className="font-medium">{authorLabel(comment)}</span>
                  <LocalTime iso={comment.createdAt} />
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
        <p aria-live="polite" className="h-5 text-xs italic text-neutral-600 dark:text-neutral-400" data-testid="typing">
          {typingText}
        </p>
      </section>
    </>
  );
}
