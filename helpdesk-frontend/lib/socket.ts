import { useSyncExternalStore } from 'react';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';

// Browser code only. The browser talks to the API directly here (the one place it does), so the API checks the
// Origin of every handshake against its allowlist (FRONTEND_ORIGIN).
const SOCKET_URL = `${process.env.NEXT_PUBLIC_SOCKET_URL ?? 'http://localhost:4310'}/support`;

export type ConnectionState = 'connecting' | 'live' | 'offline';

let socket: Socket | null = null;
let holders = 0;
let state: ConnectionState = 'offline';
let everConnected = false;
const joined = new Set<string>();
const stateListeners = new Set<() => void>();
const reconnectListeners = new Set<() => void>();

function setState(next: ConnectionState) {
  if (state === next) return;
  state = next;
  stateListeners.forEach((listener) => listener());
}

/** A fresh 60-second socket token from this site's own server (which holds the httpOnly login cookie). */
async function fetchToken(): Promise<string | null> {
  try {
    const res = await fetch('/api/socket-token', { cache: 'no-store' });
    if (res.status === 401) {
      // The login session itself has ended: a full page load is deliberate, it throws away all socket state.
      window.location.href = new URL("/login?expired=1", window.location.origin).href;
      return null;
    }
    return res.ok ? ((await res.json()) as { token: string }).token : null;
  } catch {
    return null;
  }
}

function connectSocket(): Socket {
  const next = io(SOCKET_URL, {
    transports: ['websocket'],
    // Runs before every connection attempt, so every reconnect uses a new token (they only live 60 seconds).
    auth: (done) => {
      void fetchToken().then((token) => done({ token: token ?? '' }));
    },
  });

  next.on('connect', () => {
    setState('live');
    // A new connection starts in no rooms: rejoin what the page is showing.
    for (const ticketId of joined) next.emit('ticket:join', { ticketId });
    // Anything that happened while we were away was missed, so tell the pages to reload their data.
    if (everConnected) reconnectListeners.forEach((listener) => listener());
    everConnected = true;
  });
  next.on('disconnect', (reason) => {
    setState('connecting');
    // When the server hangs up on purpose (the login session ended) Socket.io does not retry by itself.
    if (reason === 'io server disconnect') setTimeout(() => next.connect(), 500);
  });
  next.on('connect_error', () => {
    setState('offline');
    // A refused handshake (e.g. a token that expired in transit) is not retried automatically either.
    setTimeout(() => {
      if (holders > 0 && !next.active) next.connect();
    }, 3000);
  });
  return next;
}

/** Call from an effect; call the returned function in its cleanup. The socket closes when the last user leaves. */
export function acquireSocket(): { socket: Socket; release: () => void } {
  if (!socket) {
    socket = connectSocket();
    setState('connecting');
  }
  holders += 1;
  const current = socket;
  let released = false;
  return {
    socket: current,
    release: () => {
      if (released) return;
      released = true;
      holders -= 1;
      if (holders === 0) {
        socket = null;
        everConnected = false;
        joined.clear();
        current.close();
        setState('offline');
      }
    },
  };
}

/** Joins a ticket's room (and rejoins it after every reconnect). Returns the function that leaves it. */
export function joinTicket(ticketId: string) {
  joined.add(ticketId);
  if (socket?.connected) socket.emit('ticket:join', { ticketId });
  return () => {
    joined.delete(ticketId);
    if (socket?.connected) socket.emit('ticket:leave', { ticketId });
  };
}

export function onReconnect(listener: () => void) {
  reconnectListeners.add(listener);
  return () => {
    reconnectListeners.delete(listener);
  };
}

export function useConnectionState(): ConnectionState {
  return useSyncExternalStore(
    (listener) => {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
    () => state,
    () => 'offline',
  );
}

// --- typing indicator: "started" at most every 2 seconds while keys are pressed, "stopped" after 3 quiet seconds ---

let lastStarted = 0;
let wasInternal = false;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

function sendTyping(ticketId: string, isTyping: boolean, isInternalNote: boolean) {
  if (socket?.connected) socket.emit('typing', { ticketId, isTyping, isInternalNote });
}

export function emitTyping(ticketId: string, isInternalNote: boolean) {
  const now = Date.now();
  if (now - lastStarted > 2000 || isInternalNote !== wasInternal) {
    sendTyping(ticketId, true, isInternalNote);
    lastStarted = now;
    wasInternal = isInternalNote;
  }
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => stopTyping(ticketId), 3000);
}

export function stopTyping(ticketId: string) {
  clearTimeout(idleTimer);
  if (lastStarted) sendTyping(ticketId, false, wasInternal);
  lastStarted = 0;
}
