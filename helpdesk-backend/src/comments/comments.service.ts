import { ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard.js';
import type { Role } from '../auth/role.js';
import { DatabaseService } from '../database/database.service.js';
import { SupportGateway } from '../realtime/support.gateway.js';
import { TicketsService } from '../tickets/tickets.service.js';
import { CreateCommentDto } from './dto/create-comment.dto.js';

// Every query aliases comments as "c" and joins its author as "u" (same org, so RLS and the composite FK agree).
const COMMENT_COLUMNS = `c.id, c.ticket_id AS "ticketId", c.author_id AS "authorId",
  u.role AS "authorRole", u.email AS "authorEmail",
  c.message, c.is_internal_note AS "isInternalNote", c.created_at AS "createdAt"`;

export interface CommentRow {
  id: string;
  ticketId: string;
  authorId: string;
  authorRole: Role;
  authorEmail: string | null;
  message: string;
  isInternalNote: boolean;
  createdAt: Date;
}

@Injectable()
export class CommentsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly tickets: TicketsService,
    private readonly realtime: SupportGateway,
  ) {}

  /** Customers never receive internal notes: they are filtered out in SQL, not in the client. */
  async list(user: AuthenticatedUser, ticketId: string) {
    await this.tickets.assertAccessible(user, ticketId);
    const hideInternal =
      user.role === 'CUSTOMER' ? 'AND c.is_internal_note = false' : '';
    const { rows } = await this.db.tenantQuery<CommentRow>(
      user.orgId,
      `SELECT ${COMMENT_COLUMNS}
         FROM comments c
         JOIN users u ON u.id = c.author_id AND u.org_id = c.org_id
        WHERE c.org_id = $1 AND c.ticket_id = $2 ${hideInternal}
        ORDER BY c.created_at, c.id`,
      [ticketId],
    );
    return rows.map((row) => this.redactAuthor(user, row));
  }

  /** Customers learn who wrote a reply only as a role ("AGENT"); staff addresses stay private. Their own address is theirs to see. */
  private redactAuthor(user: AuthenticatedUser, row: CommentRow): CommentRow {
    const hide = user.role === 'CUSTOMER' && row.authorId !== user.userId;
    return hide ? { ...row, authorEmail: null } : row;
  }

  async create(
    user: AuthenticatedUser,
    ticketId: string,
    dto: CreateCommentDto,
  ) {
    const isInternalNote = dto.isInternalNote ?? false;
    if (isInternalNote && user.role === 'CUSTOMER') {
      throw new ForbiddenException('Customers cannot post internal notes');
    }
    await this.tickets.assertAccessible(user, ticketId);
    // The CTE inserts, then the outer SELECT joins the author so the response has the same shape as list().
    const { rows } = await this.db.tenantQuery<CommentRow>(
      user.orgId,
      `WITH c AS (
         INSERT INTO comments (org_id, ticket_id, author_id, message, is_internal_note)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *
       )
       SELECT ${COMMENT_COLUMNS}
         FROM c
         JOIN users u ON u.id = c.author_id AND u.org_id = c.org_id`,
      [ticketId, user.userId, dto.message, isInternalNote],
    );
    // Pushed unredacted: the gateway decides per audience who may see the author's address.
    this.realtime.publishComment(user.orgId, rows[0]);
    return this.redactAuthor(user, rows[0]);
  }
}
