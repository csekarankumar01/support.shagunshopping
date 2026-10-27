'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { acquireSocket, onReconnect } from '@/lib/socket';

/**
 * For staff pages (queue, dashboard): when anything they show changes (a new ticket, a status or assignee change,
 * an SLA breach, a colleague coming online or going offline), reload the page's data from the server.
 */
export function LiveRefresh() {
  const router = useRouter();
  useEffect(() => {
    const { socket, release } = acquireSocket();
    let pending: ReturnType<typeof setTimeout> | undefined;
    const refreshSoon = () => {
      clearTimeout(pending); // several changes close together cause one reload
      pending = setTimeout(() => router.refresh(), 400);
    };
    socket.on('ticket:status', refreshSoon);
    socket.on('presence:changed', refreshSoon);
    socket.on('ticket:created', refreshSoon);
    socket.on('ticket:assigned', refreshSoon);
    socket.on('sla:breached', refreshSoon);
    // The page was rendered on the server before this socket existed, and the server's "someone came online" message
    // can arrive before this component has even mounted. So read the data once more as soon as the socket is up.
    if (socket.connected) refreshSoon();
    else socket.once('connect', refreshSoon);
    const stopReloading = onReconnect(refreshSoon);
    return () => {
      clearTimeout(pending);
      socket.off('ticket:status', refreshSoon);
      socket.off('presence:changed', refreshSoon);
      socket.off('ticket:created', refreshSoon);
      socket.off('ticket:assigned', refreshSoon);
      socket.off('sla:breached', refreshSoon);
      socket.off('connect', refreshSoon);
      stopReloading();
      release();
    };
  }, [router]);
  return null;
}
