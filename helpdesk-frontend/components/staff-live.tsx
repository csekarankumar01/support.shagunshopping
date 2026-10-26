'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { acquireSocket } from '@/lib/socket';

interface Alert {
  ticketId: string;
  subject: string;
  priority: string;
}

interface Toast extends Alert {
  key: number;
  kind: 'created' | 'breached';
}

/**
 * For staff, on every page: a pop-up when a new ticket arrives and a red one when a ticket breaches its SLA
 * (workflow B's "red WebSocket alert"). Clicking it opens the ticket. Customers never get this component.
 */
export function StaffLive() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);

  useEffect(() => {
    const { socket, release } = acquireSocket();
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const show = (kind: Toast['kind']) => (alert: Alert) => {
      const key = (counter.current += 1);
      setToasts((current) => [...current.slice(-3), { ...alert, kind, key }]);
      const timer = setTimeout(() => {
        setToasts((current) => current.filter((toast) => toast.key !== key));
        timers.delete(timer);
      }, kind === 'breached' ? 15_000 : 8_000);
      timers.add(timer);
    };
    const onCreated = show('created');
    const onBreached = show('breached');
    socket.on('ticket:created', onCreated);
    socket.on('sla:breached', onBreached);
    return () => {
      socket.off('ticket:created', onCreated);
      socket.off('sla:breached', onBreached);
      timers.forEach(clearTimeout);
      release();
    };
  }, []);

  if (toasts.length === 0) return null;
  return (
    <div aria-live="assertive" className="fixed right-4 bottom-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2" data-testid="toasts">
      {toasts.map((toast) => (
        <Link
          key={toast.key}
          href={`/tickets/${toast.ticketId}`}
          onClick={() => setToasts((current) => current.filter((t) => t.key !== toast.key))}
          className={
            toast.kind === 'breached'
              ? 'rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900 shadow-lg dark:border-red-800 dark:bg-red-950 dark:text-red-100'
              : 'rounded-md border border-blue-300 bg-blue-50 px-4 py-3 text-sm text-blue-900 shadow-lg dark:border-blue-800 dark:bg-blue-950 dark:text-blue-100'
          }
        >
          <span className="block font-medium">
            {toast.kind === 'breached' ? 'SLA breached' : 'New ticket'} · {toast.priority}
          </span>
          <span className="block [overflow-wrap:anywhere]">{toast.subject}</span>
        </Link>
      ))}
    </div>
  );
}
