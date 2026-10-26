import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard.js';
import type { Role } from '../auth/role.js';
import { SessionService } from '../auth/session.service.js';
import { DatabaseService } from '../database/database.service.js';

export interface Member {
  userId: string;
  email: string;
  role: Role;
  isActive: boolean;
  createdAt: Date;
}

@Injectable()
export class TeamService {
  constructor(
    private readonly db: DatabaseService,
    private readonly sessions: SessionService,
  ) {}

  /** Agents see the staff (who they can assign tickets to); admins see everyone. No password data is selected. */
  async list(user: AuthenticatedUser): Promise<Member[]> {
    const staffOnly =
      user.role === 'AGENT'
        ? `AND role IN ('ADMIN', 'AGENT') AND is_active`
        : '';
    const { rows } = await this.db.tenantQuery<Member>(
      user.orgId,
      `SELECT id AS "userId", email, role, is_active AS "isActive", created_at AS "createdAt"
         FROM users WHERE org_id = $1 ${staffOnly}
        ORDER BY CASE role WHEN 'ADMIN' THEN 0 WHEN 'AGENT' THEN 1 ELSE 2 END, email`,
    );
    return rows;
  }

  /**
   * Admin changes a member's role (agent or customer) or switches them on or off.
   * Rules: not yourself, and never another admin (admins only come from registering the organisation), so an
   * organisation can never lock itself out. Everything happens in one transaction, and the person's sessions are
   * revoked afterwards, so the change takes effect at once, even in a browser that is open right now.
   */
  async update(
    admin: AuthenticatedUser,
    userId: string,
    change: { role?: Role; isActive?: boolean },
  ): Promise<Member> {
    if (userId === admin.userId) {
      throw new ForbiddenException('You cannot change your own account here');
    }
    const { member, sids } = await this.db.tenantTransaction(
      admin.orgId,
      async (q) => {
        const found = await q<Member>(
          `SELECT id AS "userId", email, role, is_active AS "isActive", created_at AS "createdAt"
           FROM users WHERE org_id = $1 AND id = $2 FOR UPDATE`,
          [userId],
        );
        const target = found.rows[0];
        if (!target) throw new NotFoundException('User not found');
        if (target.role === 'ADMIN') {
          throw new ForbiddenException('Admin accounts cannot be changed here');
        }
        const role = change.role ?? target.role;
        const isActive = change.isActive ?? target.isActive;
        if (role === target.role && isActive === target.isActive) {
          return { member: target, sids: [] as string[] };
        }

        await q(
          `UPDATE users SET role = $3, is_active = $4 WHERE org_id = $1 AND id = $2`,
          [userId, role, isActive],
        );

        // A person who can no longer work tickets must not keep them: hand their open tickets back to the queue.
        if (target.role !== 'CUSTOMER' && (role === 'CUSTOMER' || !isActive)) {
          const released = await q<{ id: string }>(
            `UPDATE tickets SET agent_id = NULL, updated_at = now()
            WHERE org_id = $1 AND agent_id = $2 AND status IN ('OPEN', 'IN_PROGRESS') RETURNING id`,
            [userId],
          );
          for (const ticket of released.rows) {
            await q(
              `INSERT INTO audit_logs (org_id, ticket_id, actor_id, action, old_val, new_val)
             VALUES ($1, $2, $3, 'ASSIGNED', $4, NULL)`,
              [ticket.id, admin.userId, userId],
            );
          }
        }
        const sids = await this.sessions.revokeAllOf(q, userId);
        return { member: { ...target, role, isActive }, sids };
      },
    );
    await this.sessions.announce(sids);
    return member;
  }
}
