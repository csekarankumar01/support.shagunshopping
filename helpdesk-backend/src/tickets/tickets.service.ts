import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard.js';
import { DatabaseService } from '../database/database.service.js';
import { CreateTicketDto } from './dto/create-ticket.dto.js';
import { ListTicketsQueryDto } from './dto/list-tickets-query.dto.js';
import type { TicketStatus } from './ticket.constants.js';

const TICKET_COLUMNS = `id, subject, status, priority,
  requester_id AS "requesterId", agent_id AS "agentId",
  sla_deadline AS "slaDeadline", created_at AS "createdAt"`;

export interface TicketRow {
  id: string;
  subject: string;
  status: TicketStatus;
  priority: string;
  requesterId: string;
  agentId: string | null;
  slaDeadline: Date;
  createdAt: Date;
}

@Injectable()
export class TicketsService {
  constructor(private readonly db: DatabaseService) {}

  /** The SLA deadline is set in SQL from the organisation's own sla_mins (plan workflow A). */
  async create(user: AuthenticatedUser, dto: CreateTicketDto) {
    const { rows } = await this.db.tenantQuery<TicketRow>(
      user.orgId,
      `INSERT INTO tickets (org_id, requester_id, subject, priority, sla_deadline)
       SELECT o.id, $2::uuid, $3::text, $4::text, now() + make_interval(mins => o.sla_mins)
         FROM organizations o
        WHERE o.id = $1
       RETURNING ${TICKET_COLUMNS}`,
      [user.userId, dto.subject, dto.priority ?? 'MEDIUM'],
    );
    return rows[0];
  }

  async list(user: AuthenticatedUser, query: ListTicketsQueryDto) {
    // Only fixed SQL fragments are joined here; every value travels in params.
    const params: unknown[] = [];
    const where = ['org_id = $1'];
    const add = (condition: string, value: unknown) => {
      params.push(value);
      where.push(condition.replace('?', `$${params.length + 1}`));
    };
    if (user.role === 'CUSTOMER') add('requester_id = ?', user.userId);
    if (query.status) add('status = ?', query.status);
    if (query.priority) add('priority = ?', query.priority);
    const whereSql = where.join(' AND ');

    const limitIndex = params.length + 2;
    const [items, count] = await Promise.all([
      this.db.tenantQuery<TicketRow>(
        user.orgId,
        `SELECT ${TICKET_COLUMNS} FROM tickets
          WHERE ${whereSql}
          ORDER BY created_at DESC, id
          LIMIT $${limitIndex} OFFSET $${limitIndex + 1}`,
        [...params, query.limit, (query.page - 1) * query.limit],
      ),
      this.db.tenantQuery<{ total: number }>(
        user.orgId,
        `SELECT count(*)::int AS total FROM tickets WHERE ${whereSql}`,
        params,
      ),
    ]);
    return {
      items: items.rows,
      total: count.rows[0].total,
      page: query.page,
      limit: query.limit,
    };
  }

  /**
   * Throws 404 unless the ticket is in the caller's org (and, for customers, is their own).
   * 404 rather than 403 so another tenant's ticket ids cannot be probed for existence.
   */
  async assertAccessible(user: AuthenticatedUser, ticketId: string) {
    const params: unknown[] = [ticketId];
    let ownerFilter = '';
    if (user.role === 'CUSTOMER') {
      params.push(user.userId);
      ownerFilter = 'AND requester_id = $3';
    }
    const { rowCount } = await this.db.tenantQuery(
      user.orgId,
      `SELECT 1 FROM tickets WHERE org_id = $1 AND id = $2 ${ownerFilter}`,
      params,
    );
    if (!rowCount) throw new NotFoundException('Ticket not found');
  }

  /** Status change and its audit row are saved together or not at all. */
  async updateStatus(
    user: AuthenticatedUser,
    ticketId: string,
    status: TicketStatus,
  ) {
    return this.db.tenantTransaction(user.orgId, async (q) => {
      const current = await q<{ status: TicketStatus }>(
        'SELECT status FROM tickets WHERE org_id = $1 AND id = $2 FOR UPDATE',
        [ticketId],
      );
      if (!current.rowCount) throw new NotFoundException('Ticket not found');
      const oldStatus = current.rows[0].status;

      if (oldStatus !== status) {
        await q(
          'UPDATE tickets SET status = $3, updated_at = now() WHERE org_id = $1 AND id = $2',
          [ticketId, status],
        );
        await q(
          `INSERT INTO audit_logs (org_id, ticket_id, actor_id, action, old_val, new_val)
           VALUES ($1, $2, $3, 'STATUS_CHANGED', $4, $5)`,
          [ticketId, user.userId, oldStatus, status],
        );
      }
      const updated = await q<TicketRow>(
        `SELECT ${TICKET_COLUMNS} FROM tickets WHERE org_id = $1 AND id = $2`,
        [ticketId],
      );
      return updated.rows[0];
    });
  }
}
