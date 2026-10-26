import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import { verifyToken } from '../auth/verify-token.js';
import type { AuthenticatedUser } from '../auth/verify-token.js';
import { DatabaseService } from '../database/database.service.js';
import { canAccessTicket } from '../tickets/ticket-access.js';
import { rooms } from './events.js';
import type { Ack, LiveComment, StatusChange, TypingEvent } from './events.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ROOMS_PER_SOCKET = 50;
const MAX_TIMER_MS = 2 ** 31 - 1;

interface SocketData {
  user: AuthenticatedUser;
  sessionExp: number;
}
type SupportSocket = Socket & { data: SocketData };

const isStaff = (user: AuthenticatedUser) => user.role !== 'CUSTOMER';
const ticketIdFrom = (body: unknown) => {
  const id = (body as { ticketId?: unknown } | null)?.ticketId;
  return typeof id === 'string' && UUID.test(id) ? id : null;
};

/**
 * Live ticket chat at wss://.../support.
 *
 * Who is allowed in:  the handshake must carry a valid 60-second socket token (see verifyToken) from an allowed
 *                     browser origin. The org, user and role come only from that token.
 * What a socket may hear:  it joins a ticket's room only after the same access check the REST API uses, and rooms
 *                     are always prefixed with the org id, so another organisation's traffic is unreachable.
 * How messages get here:  they are written through the REST endpoints (validated, saved, audited) and then
 *                     published from there. The socket is for delivery, not for writing.
 */
@WebSocketGateway({
  namespace: 'support',
  // Browsers only; plain polling would add a second, CORS-governed door to guard.
  transports: ['websocket'],
})
export class SupportGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(SupportGateway.name);
  private readonly allowedOrigins: string[];

  @WebSocketServer()
  private server?: Namespace;

  constructor(
    private readonly jwt: JwtService,
    private readonly db: DatabaseService,
    config: ConfigService,
  ) {
    this.allowedOrigins = config
      .get<string>('FRONTEND_ORIGIN', 'http://localhost:4311')
      .split(',')
      .map((origin) => origin.trim());
  }

  /** Runs for every connection attempt, before it is accepted. */
  afterInit(server: Namespace) {
    server.use(async (socket, next) => {
      // Browsers always send Origin on a WebSocket handshake. A page on another site must not be able to connect.
      const origin = socket.handshake.headers.origin;
      if (origin && !this.allowedOrigins.includes(origin)) {
        return next(new Error('unauthorized'));
      }
      const token = (socket.handshake.auth as { token?: unknown }).token;
      if (typeof token !== 'string') return next(new Error('unauthorized'));
      try {
        const { user, sessionExp } = await verifyToken(
          this.jwt,
          token,
          'socket',
        );
        socket.data = { user, sessionExp } satisfies SocketData;
        next();
      } catch {
        next(new Error('unauthorized')); // same answer for every reason
      }
    });
  }

  handleConnection(socket: SupportSocket) {
    const { user, sessionExp } = socket.data;
    if (isStaff(user)) void socket.join(rooms.agents(user.orgId));

    // The socket lives no longer than the login session it came from.
    const timer = setTimeout(
      () => {
        socket.emit('session:expired');
        socket.disconnect(true);
      },
      Math.min(Math.max(sessionExp * 1000 - Date.now(), 0), MAX_TIMER_MS),
    );
    socket.once('disconnect', () => clearTimeout(timer));
  }

  @SubscribeMessage('ticket:join')
  async join(
    @ConnectedSocket() socket: SupportSocket,
    @MessageBody() body: unknown,
  ): Promise<Ack> {
    const ticketId = ticketIdFrom(body);
    if (!ticketId) return { ok: false, error: 'Invalid ticket id' };
    const { user } = socket.data;
    if (socket.rooms.size >= MAX_ROOMS_PER_SOCKET) {
      return { ok: false, error: 'Too many open tickets' };
    }
    try {
      // Same answer for "does not exist" and "not yours", like the REST API's 404.
      if (!(await canAccessTicket(this.db, user, ticketId))) {
        return { ok: false, error: 'Ticket not found' };
      }
    } catch (err) {
      this.logger.error(`ticket:join failed: ${(err as Error).message}`);
      return { ok: false, error: 'Could not join' };
    }
    await socket.join(rooms.ticket(user.orgId, ticketId));
    if (isStaff(user))
      await socket.join(rooms.ticketStaff(user.orgId, ticketId));
    return { ok: true };
  }

  @SubscribeMessage('ticket:leave')
  async leave(
    @ConnectedSocket() socket: SupportSocket,
    @MessageBody() body: unknown,
  ): Promise<Ack> {
    const ticketId = ticketIdFrom(body);
    if (!ticketId) return { ok: false, error: 'Invalid ticket id' };
    const { orgId } = socket.data.user;
    await socket.leave(rooms.ticket(orgId, ticketId));
    await socket.leave(rooms.ticketStaff(orgId, ticketId));
    return { ok: true };
  }

  /**
   * "Someone is typing". Only for a ticket the socket has joined. Typing an internal note is shown to staff only,
   * so a customer cannot even learn that a note is being written; a customer cannot claim to be writing one.
   */
  @SubscribeMessage('typing')
  typing(
    @ConnectedSocket() socket: SupportSocket,
    @MessageBody() body: unknown,
  ): Ack {
    const ticketId = ticketIdFrom(body);
    const { isTyping, isInternalNote } = (body ?? {}) as {
      isTyping?: unknown;
      isInternalNote?: unknown;
    };
    if (!ticketId || typeof isTyping !== 'boolean') {
      return { ok: false, error: 'Invalid typing event' };
    }
    const { user } = socket.data;
    const internal = isInternalNote === true && isStaff(user);
    const ticketRoom = rooms.ticket(user.orgId, ticketId);
    if (!socket.rooms.has(ticketRoom)) {
      return { ok: false, error: 'Join the ticket first' };
    }
    const event: TypingEvent = {
      ticketId,
      userId: user.userId,
      role: user.role,
      isTyping,
      isInternalNote: internal,
    };
    socket
      .to(internal ? rooms.ticketStaff(user.orgId, ticketId) : ticketRoom)
      .emit('typing', event);
    return { ok: true };
  }

  // --- Publishing: called by the REST services after a change has been saved ---

  /**
   * Staff get every comment with its author's address. The customer's side of the room gets public comments only,
   * and learns a staff author's role but not their address. An internal note never goes anywhere near the
   * `ticket` room: it is emitted to the staff room alone.
   */
  publishComment(orgId: string, comment: LiveComment) {
    if (!this.server) return;
    const staffRoom = rooms.ticketStaff(orgId, comment.ticketId);
    this.server.to(staffRoom).emit('comment:new', comment);
    if (comment.isInternalNote) return;
    const forCustomer: LiveComment = {
      ...comment,
      authorEmail:
        comment.authorRole === 'CUSTOMER' ? comment.authorEmail : null,
    };
    this.server
      .to(rooms.ticket(orgId, comment.ticketId))
      .except(staffRoom)
      .emit('comment:new', forCustomer);
  }

  /** The ticket's own viewers, plus every connected staff member (their queue shows the status). */
  publishStatus(orgId: string, change: StatusChange) {
    this.server
      ?.to(rooms.ticket(orgId, change.ticketId))
      .to(rooms.agents(orgId))
      .emit('ticket:status', change);
  }
}
