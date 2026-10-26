import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard.js';
import { DatabaseService } from '../database/database.service.js';
import { enqueueEvent, TOPICS } from '../events/events.js';
import { SupportGateway } from '../realtime/support.gateway.js';
import { SlaService } from '../sla/sla.service.js';
import { CreateTicketDto } from './dto/create-ticket.dto.js';
import { ListTicketsQueryDto } from './dto/list-tickets-query.dto.js';
import { canAccessTicket } from './ticket-access.js';
import type { TicketStatus } from './ticket.constants.js';

const TICKET_COLUMNS = `id, subject, status, priority,
  requester_id AS "requesterId", agent_id AS "agentId",
  sla_deadline AS "slaDeadline", created_at AS "createdAt",
  first_response_at AS "firstResponseAt", sla_breached_at AS "slaBreachedAt"`;

export interface TicketRow {
  id: string;
  subject: string;
  status: TicketStatus;
  priority: string;
  requesterId: string;
  agentId: string | null;
  slaDeadline: Date;
  createdAt: Date;
  firstResponseAt: Date | null;
  slaBreachedAt: Date | null;
}

const ACTIVE = `status IN ('OPEN', 'IN_PROGRESS')`;
const escapeLike = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

@Injectable()
export class TicketsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly realtime: SupportGateway,
    private readonly sla: SlaService,
  ) {}

  /**
   * The SLA deadline is set in SQL from the organisation's own sla_mins (plan workflow A). The `ticket.created`
   * event is written to the outbox in the same transaction, so the ticket and its event commit together;
   * a relay publishes it to Kafka afterwards and the request never waits for the broker.
   */
  async create(user: AuthenticatedUser, dto: CreateTicketDto) {
    return this.db.tenantTransaction(user.orgId, async (q) => {
      const { rows } = await q<TicketRow>(
        `INSERT INTO tickets (org_id, requester_id, subject, priority, sla_deadline)
         SELECT o.id, $2::uuid, $3::text, $4::text, now() + make_interval(mins => o.sla_mins)
           FROM organizations o
          WHERE o.id = $1
         RETURNING ${TICKET_COLUMNS}`,
        [user.userId, dto.subject, dto.priority ?? 'MEDIUM'],
      );
      const ticket = rows[0];
      await enqueueEvent(q, TOPICS.TICKET_CREATED, {
        ticketId: ticket.id,
        requesterId: ticket.requesterId,
        subject: ticket.subject,
        priority: ticket.priority,
        slaDeadline: ticket.slaDeadline.toISOString(),
        createdAt: ticket.createdAt.toISOString(),
      });
      return ticket;
    });
  }

  async list(user: AuthenticatedUser, query: ListTicketsQueryDto) {
    // Only fixed SQL fragments are joined here; every value travels in params.
    const params: unknown[] = [];
    const where = ['org_id = $1'];
    const add = (condition: string, value: unknown) => {
      params.push(value);
      where.push(condition.replace('?', `$${params.length + 1}`));
    };
    const staff = user.role !== 'CUSTOMER';
    if (!staff) add('requester_id = ?', user.userId);
    if (query.status) add('status = ?', query.status);
    if (query.priority) add('priority = ?', query.priority);
    if (query.q)
      add(`subject ILIKE '%' || ? || '%' ESCAPE '\\'`, escapeLike(query.q));
    if (staff && query.assigned === 'me') add('agent_id = ?', user.userId);
    if (staff && query.assigned === 'unassigned')
      where.push('agent_id IS NULL');
    if (query.breached) where.push('sla_breached_at IS NOT NULL');
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

  /** Dashboard numbers for staff: counts by status and priority, SLA breaches, workload, and response time. */
  async stats(user: AuthenticatedUser) {
    const { rows } = await this.db.tenantQuery<Record<string, number | null>>(
      user.orgId,
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE status = 'OPEN')::int AS open,
              count(*) FILTER (WHERE status = 'IN_PROGRESS')::int AS "inProgress",
              count(*) FILTER (WHERE status = 'RESOLVED')::int AS resolved,
              count(*) FILTER (WHERE status = 'CLOSED')::int AS closed,
              count(*) FILTER (WHERE ${ACTIVE} AND priority = 'LOW')::int AS "activeLow",
              count(*) FILTER (WHERE ${ACTIVE} AND priority = 'MEDIUM')::int AS "activeMedium",
              count(*) FILTER (WHERE ${ACTIVE} AND priority = 'HIGH')::int AS "activeHigh",
              count(*) FILTER (WHERE ${ACTIVE} AND priority = 'URGENT')::int AS "activeUrgent",
              count(*) FILTER (WHERE sla_breached_at IS NOT NULL)::int AS breached,
              count(*) FILTER (WHERE ${ACTIVE} AND agent_id IS NULL)::int AS unassigned,
              count(*) FILTER (WHERE ${ACTIVE} AND agent_id = $2)::int AS "assignedToMe",
              count(*) FILTER (WHERE created_at > now() - interval '24 hours')::int AS "createdLast24h",
              (avg(extract(epoch FROM first_response_at - created_at))
                 FILTER (WHERE first_response_at IS NOT NULL))::float8 AS "avgFirstResponseSeconds"
         FROM tickets WHERE org_id = $1`,
      [user.userId],
    );
    return rows[0];
  }

  /** One ticket, with the same visibility rules (and the same 404) as assertAccessible. */
  async get(user: AuthenticatedUser, ticketId: string) {
    const params: unknown[] = [ticketId];
    let ownerFilter = '';
    if (user.role === 'CUSTOMER') {
      params.push(user.userId);
      ownerFilter = 'AND requester_id = $3';
    }
    const { rows } = await this.db.tenantQuery<TicketRow>(
      user.orgId,
      `SELECT ${TICKET_COLUMNS} FROM tickets
        WHERE org_id = $1 AND id = $2 ${ownerFilter}`,
      params,
    );
    if (!rows[0]) throw new NotFoundException('Ticket not found');
    return rows[0];
  }

  /**
   * Throws 404 unless the ticket is in the caller's org (and, for customers, is their own).
   * 404 rather than 403 so another tenant's ticket ids cannot be probed for existence.
   */
  async assertAccessible(user: AuthenticatedUser, ticketId: string) {
    if (!(await canAccessTicket(this.db, user, ticketId))) {
      throw new NotFoundException('Ticket not found');
    }
  }

  /** Status change and its audit row are saved together or not at all. */
  async updateStatus(
    user: AuthenticatedUser,
    ticketId: string,
    status: TicketStatus,
  ) {
    const { ticket, changed } = await this.db.tenantTransaction(
      user.orgId,
      async (q) => {
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
        return { ticket: updated.rows[0], changed: oldStatus !== status };
      },
    );
    // Published only after the transaction has committed, so nobody is told about a change that was rolled back.
    if (changed) {
      this.realtime.publishStatus(user.orgId, { ticketId, status });
      // A resolved or closed ticket can no longer breach its SLA.
      if (status === 'RESOLVED' || status === 'CLOSED') {
        await this.sla.cancel(user.orgId, ticketId);
      }
    }
    return ticket;
  }

  /** Assigns the ticket to an agent or admin of the same organisation, or to nobody (null). Audited. */
  async assign(
    user: AuthenticatedUser,
    ticketId: string,
    agentId: string | null,
  ) {
    const { ticket, changed } = await this.db.tenantTransaction(
      user.orgId,
      async (q) => {
        const current = await q<{ agentId: string | null }>(
          `SELECT agent_id AS "agentId" FROM tickets WHERE org_id = $1 AND id = $2 FOR UPDATE`,
          [ticketId],
        );
        if (!current.rowCount) throw new NotFoundException('Ticket not found');
        if (agentId) {
          const staff = await q(
            `SELECT 1 FROM users WHERE org_id = $1 AND id = $2 AND role IN ('ADMIN', 'AGENT')`,
            [agentId],
          );
          if (!staff.rowCount) {
            throw new BadRequestException(
              'A ticket can only be assigned to an agent or admin of this organisation',
            );
          }
        }
        const oldAgent = current.rows[0].agentId;
        if (oldAgent !== agentId) {
          await q(
            'UPDATE tickets SET agent_id = $3::uuid, updated_at = now() WHERE org_id = $1 AND id = $2',
            [ticketId, agentId],
          );
          await q(
            `INSERT INTO audit_logs (org_id, ticket_id, actor_id, action, old_val, new_val)
             VALUES ($1, $2, $3, 'ASSIGNED', $4, $5)`,
            [ticketId, user.userId, oldAgent, agentId],
          );
        }
        const updated = await q<TicketRow>(
          `SELECT ${TICKET_COLUMNS} FROM tickets WHERE org_id = $1 AND id = $2`,
          [ticketId],
        );
        return { ticket: updated.rows[0], changed: oldAgent !== agentId };
      },
    );
    if (changed)
      this.realtime.publishAssigned(user.orgId, { ticketId, agentId });
    return ticket;
  }
}
