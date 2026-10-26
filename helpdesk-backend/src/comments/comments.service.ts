import { ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard.js';
import { DatabaseService } from '../database/database.service.js';
import { TicketsService } from '../tickets/tickets.service.js';
import { CreateCommentDto } from './dto/create-comment.dto.js';

const COMMENT_COLUMNS = `c.id, c.ticket_id AS "ticketId", c.author_id AS "authorId",
  c.message, c.is_internal_note AS "isInternalNote", c.created_at AS "createdAt"`;

@Injectable()
export class CommentsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly tickets: TicketsService,
  ) {}

  /** Customers never receive internal notes: they are filtered out in SQL, not in the client. */
  async list(user: AuthenticatedUser, ticketId: string) {
    await this.tickets.assertAccessible(user, ticketId);
    const hideInternal =
      user.role === 'CUSTOMER' ? 'AND c.is_internal_note = false' : '';
    const { rows } = await this.db.tenantQuery(
      user.orgId,
      `SELECT ${COMMENT_COLUMNS}
         FROM comments c
        WHERE c.org_id = $1 AND c.ticket_id = $2 ${hideInternal}
        ORDER BY c.created_at, c.id`,
      [ticketId],
    );
    return rows;
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
    const { rows } = await this.db.tenantQuery(
      user.orgId,
      `INSERT INTO comments (org_id, ticket_id, author_id, message, is_internal_note)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${COMMENT_COLUMNS.replaceAll('c.', '')}`,
      [ticketId, user.userId, dto.message, isInternalNote],
    );
    return rows[0];
  }
}
