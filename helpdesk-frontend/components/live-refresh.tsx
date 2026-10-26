'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { acquireSocket, onReconnect } from '@/lib/socket';

/**
 * For the staff queue: when any ticket in the organisation changes status, reload the list's data from the
 * server. (New tickets will arrive the same way once Step 8's event bus can announce them.)
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
    const stopReloading = onReconnect(refreshSoon);
    return () => {
      clearTimeout(pending);
      socket.off('ticket:status', refreshSoon);
      stopReloading();
      release();
    };
  }, [router]);
  return null;
}
