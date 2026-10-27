import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import type { PoolClient } from 'pg';
import { RevocationService } from '../auth/revocation.service.js';
import { DatabaseService } from '../database/database.service.js';
import type { Role } from '../auth/role.js';
import { ROLES } from '../auth/role.js';
import { decryptSecret, verifyCode } from './totp.js';

/** A platform login lasts one hour; there is no refresh, the operator simply signs in again. */
export const PLATFORM_TOKEN_SECONDS = 3600;
export const PLATFORM_PURPOSE = 'platform';
const PLANS = ['FREE', 'PRO', 'ENT'] as const;

export interface PlatformAdmin {
  id: string;
  email: string;
}

/**
 * The super admin console's logic. Everything runs in db.platformTransaction, which switches on the platform_*
 * Row-Level Security policies for that transaction. Rules:
 *  - password hashes and token hashes are never selected;
 *  - every change, and every look at ticket contents, is written to platform_audit_logs in the same transaction.
 */
@Injectable()
export class PlatformService {
  private decoyHash = bcrypt.hashSync(randomBytes(16).toString('hex'), 10);
  private readonly appSecret: string;
  /** In production set PLATFORM_REQUIRE_2FA=true: a super admin without two-factor then cannot sign in at all. */
  private readonly requireTwoFactor: boolean;

  constructor(
    private readonly db: DatabaseService,
    private readonly jwt: JwtService,
    private readonly revocation: RevocationService,
    config: ConfigService,
  ) {
    this.appSecret = config.getOrThrow<string>('JWT_SECRET');
    this.requireTwoFactor =
      config.get<string>('PLATFORM_REQUIRE_2FA', 'false') === 'true';
  }

  private audit(
    client: PoolClient,
    admin: PlatformAdmin,
    action: string,
    target: {
      orgId?: string;
      type?: string;
      id?: string;
      details?: object;
    } = {},
  ) {
    return client.query(
      `INSERT INTO platform_audit_logs (admin_id, admin_email, action, org_id, target_type, target_id, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        admin.id,
        admin.email,
        action,
        target.orgId ?? null,
        target.type ?? null,
        target.id ?? null,
        JSON.stringify(target.details ?? {}),
      ],
    );
  }

  // ------------------------------------------------------------------ login

  async login(email: string, password: string, code?: string) {
    const { rows } = await this.db.query<{
      id: string;
      email: string;
      password_hash: string;
      is_active: boolean;
      totp_secret: string | null;
      totp_enabled: boolean;
      totp_last_step: string;
    }>('SELECT id, email, password_hash, is_active, totp_secret, totp_enabled, totp_last_step FROM platform_lookup_admin($1)', [email]);
    const admin = rows[0];
    // One bcrypt comparison whether or not the account exists, and one message for every failure.
    const ok = await bcrypt.compare(password, admin?.password_hash ?? this.decoyHash);
    if (!admin || !ok || !admin.is_active) {
      throw new UnauthorizedException('Invalid credentials');
    }
    // Only said after the password was right, so a stranger learns nothing about who has two-factor.
    if (admin.totp_enabled && admin.totp_secret) {
      if (!code) throw new UnauthorizedException('Two-factor code required');
      const step = verifyCode(
        decryptSecret(admin.totp_secret, this.appSecret),
        code,
        Number(admin.totp_last_step),
      );
      const used =
        step === null
          ? false
          : (
              await this.db.query<{ used: boolean }>(
                'SELECT platform_use_totp_step($1, $2) AS used',
                [admin.id, step],
              )
            ).rows[0].used;
      if (!used) throw new UnauthorizedException('Invalid credentials');
    } else if (this.requireTwoFactor) {
      throw new ForbiddenException(
        'Two-factor sign-in must be set up first: run "npm run platform:2fa -- <email>" on the server.',
      );
    }
    await this.db.query('SELECT platform_touch_login($1)', [admin.id]);
    await this.db.platformTransaction((c) =>
      this.audit(c, admin, 'LOGIN'),
    );
    const accessToken = await this.jwt.signAsync(
      { sub: admin.id, email: admin.email, purpose: PLATFORM_PURPOSE },
      { expiresIn: PLATFORM_TOKEN_SECONDS },
    );
    return { accessToken, expiresIn: PLATFORM_TOKEN_SECONDS };
  }

  // ------------------------------------------------------------------ read

  overview() {
    return this.db.platformTransaction(async (c) => {
      const { rows } = await c.query(
        `SELECT (SELECT count(*)::int FROM organizations)                                       AS organizations,
                (SELECT count(*)::int FROM organizations WHERE suspended_at IS NOT NULL)        AS suspended,
                (SELECT count(*)::int FROM organizations WHERE created_at > now() - interval '7 days') AS "newThisWeek",
                (SELECT count(*)::int FROM users WHERE is_active)                               AS users,
                (SELECT count(*)::int FROM tickets)                                             AS tickets,
                (SELECT count(*)::int FROM tickets WHERE status IN ('OPEN', 'IN_PROGRESS'))     AS "openTickets",
                (SELECT count(*)::int FROM tickets WHERE sla_breached_at IS NOT NULL)           AS "breachedTickets",
                (SELECT count(*)::int FROM dead_letters)                                        AS "failedEvents"`,
      );
      return rows[0];
    });
  }

  listOrganizations(search?: string) {
    return this.db.platformTransaction(async (c) => {
      const { rows } = await c.query(
        `SELECT org_id AS id, slug, name, plan, sla_mins AS "slaMins", status, admins::int, agents::int, customers::int,
                tickets::int, open_tickets::int AS "openTickets", created_at AS "createdAt"
           FROM v_organizations
          WHERE $1::text IS NULL OR name ILIKE '%' || $1 || '%' ESCAPE '\\' OR slug ILIKE '%' || $1 || '%' ESCAPE '\\'
          ORDER BY created_at DESC
          LIMIT 200`,
        [search ? search.replace(/[\\%_]/g, '\\$&') : null],
      );
      return rows;
    });
  }

  getOrganization(id: string) {
    return this.db.platformTransaction(async (c) => {
      const org = await c.query(
        `SELECT org_id AS id, slug, name, plan, sla_mins AS "slaMins", status, admins::int, agents::int, customers::int,
                tickets::int, open_tickets::int AS "openTickets", created_at AS "createdAt"
           FROM v_organizations WHERE org_id = $1`,
        [id],
      );
      if (!org.rows[0]) throw new NotFoundException('Organisation not found');
      const meta = await c.query(
        `SELECT suspended_at AS "suspendedAt", suspended_reason AS "suspendedReason" FROM organizations WHERE id = $1`,
        [id],
      );
      return { ...org.rows[0], ...meta.rows[0] };
    });
  }

  listUsers(orgId: string) {
    return this.db.platformTransaction(async (c) => {
      const { rows } = await c.query(
        `SELECT id, email, role, is_active AS "isActive", created_at AS "createdAt"
           FROM users WHERE org_id = $1 ORDER BY role, email`,
        [orgId],
      );
      return rows;
    });
  }

  listTickets(orgId: string, page: number, limit: number, status?: string) {
    return this.db.platformTransaction(async (c) => {
      const where = `org_id = $1 AND ($2::text IS NULL OR status = $2)`;
      const [items, count] = await Promise.all([
        c.query(
          `SELECT ticket_id AS id, subject, status, priority, requester, assigned_to AS "assignedTo",
                  sla_breached AS "slaBreached", created_at AS "createdAt"
             FROM v_tickets WHERE ${where}
            ORDER BY created_at DESC, ticket_id LIMIT $3 OFFSET $4`,
          [orgId, status ?? null, limit, (page - 1) * limit],
        ),
        c.query(`SELECT count(*)::int AS total FROM v_tickets WHERE ${where}`, [orgId, status ?? null]),
      ]);
      return { items: items.rows, total: count.rows[0].total, page, limit };
    });
  }

  /** Ticket contents, internal notes included. Reading them is itself recorded in the platform audit log. */
  getTicket(admin: PlatformAdmin, ticketId: string) {
    return this.db.platformTransaction(async (c) => {
      const ticket = await c.query(
        `SELECT ticket_id AS id, org_id AS "orgId", organisation, subject, status, priority, requester,
                assigned_to AS "assignedTo", sla_deadline AS "slaDeadline", sla_breached AS "slaBreached",
                created_at AS "createdAt"
           FROM v_tickets WHERE ticket_id = $1`,
        [ticketId],
      );
      if (!ticket.rows[0]) throw new NotFoundException('Ticket not found');
      const comments = await c.query(
        `SELECT comment_id AS id, author, author_role AS "authorRole", message, is_internal_note AS "isInternalNote",
                created_at AS "createdAt"
           FROM v_comments WHERE ticket_id = $1 ORDER BY created_at, comment_id`,
        [ticketId],
      );
      await this.audit(c, admin, 'TICKET_VIEWED', {
        orgId: ticket.rows[0].orgId,
        type: 'ticket',
        id: ticketId,
      });
      return { ...ticket.rows[0], comments: comments.rows };
    });
  }

  auditLog(orgId?: string) {
    return this.db.platformTransaction(async (c) => {
      const { rows } = await c.query(
        `SELECT id, admin_email AS "adminEmail", action, org_id AS "orgId", target_type AS "targetType",
                target_id AS "targetId", details, created_at AS "createdAt"
           FROM platform_audit_logs WHERE $1::uuid IS NULL OR org_id = $1
          ORDER BY id DESC LIMIT 200`,
        [orgId ?? null],
      );
      return rows;
    });
  }

  // ------------------------------------------------------------------ change

  async updateOrganization(
    admin: PlatformAdmin,
    id: string,
    changes: { name?: string; plan?: string; slaMins?: number },
  ) {
    if (changes.plan && !(PLANS as readonly string[]).includes(changes.plan)) {
      throw new BadRequestException('plan must be FREE, PRO or ENT');
    }
    await this.db.platformTransaction(async (c) => {
      const before = await c.query(
        'SELECT name, plan, sla_mins AS "slaMins" FROM organizations WHERE id = $1 FOR UPDATE',
        [id],
      );
      if (!before.rows[0]) throw new NotFoundException('Organisation not found');
      await c.query(
        `UPDATE organizations SET name = coalesce($2, name), plan = coalesce($3, plan), sla_mins = coalesce($4, sla_mins)
          WHERE id = $1`,
        [id, changes.name ?? null, changes.plan ?? null, changes.slaMins ?? null],
      );
      await this.audit(c, admin, 'ORG_UPDATED', {
        orgId: id,
        type: 'organization',
        id,
        details: { before: before.rows[0], changes },
      });
    });
    return this.getOrganization(id);
  }

  async suspend(admin: PlatformAdmin, id: string, reason: string) {
    const sids = await this.db.platformTransaction(async (c) => {
      const done = await c.query(
        `UPDATE organizations SET suspended_at = now(), suspended_reason = $2
          WHERE id = $1 AND suspended_at IS NULL RETURNING id`,
        [id, reason],
      );
      if (!done.rowCount) {
        const exists = await c.query('SELECT 1 FROM organizations WHERE id = $1', [id]);
        if (!exists.rowCount) throw new NotFoundException('Organisation not found');
        throw new BadRequestException('Organisation is already suspended');
      }
      // End every login of the organisation now, not when the access tokens run out.
      const revoked = await c.query<{ familyId: string }>(
        `UPDATE refresh_tokens SET revoked_at = now() WHERE org_id = $1 AND revoked_at IS NULL
         RETURNING family_id AS "familyId"`,
        [id],
      );
      await this.audit(c, admin, 'ORG_SUSPENDED', {
        orgId: id,
        type: 'organization',
        id,
        details: { reason },
      });
      return [...new Set(revoked.rows.map((r) => r.familyId))];
    });
    await this.revocation.revokeSessions(sids);
    return this.getOrganization(id);
  }

  async activate(admin: PlatformAdmin, id: string) {
    await this.db.platformTransaction(async (c) => {
      const done = await c.query(
        `UPDATE organizations SET suspended_at = NULL, suspended_reason = NULL
          WHERE id = $1 AND suspended_at IS NOT NULL RETURNING id`,
        [id],
      );
      if (!done.rowCount) {
        const exists = await c.query('SELECT 1 FROM organizations WHERE id = $1', [id]);
        if (!exists.rowCount) throw new NotFoundException('Organisation not found');
        throw new BadRequestException('Organisation is not suspended');
      }
      await this.audit(c, admin, 'ORG_ACTIVATED', { orgId: id, type: 'organization', id });
    });
    return this.getOrganization(id);
  }

  async updateUser(
    admin: PlatformAdmin,
    userId: string,
    changes: { role?: Role; isActive?: boolean },
  ) {
    if (changes.role && !ROLES.includes(changes.role)) {
      throw new BadRequestException('Unknown role');
    }
    const sids = await this.db.platformTransaction(async (c) => {
      const before = await c.query<{
        orgId: string;
        email: string;
        role: Role;
        isActive: boolean;
      }>(
        `SELECT org_id AS "orgId", email, role, is_active AS "isActive" FROM users WHERE id = $1 FOR UPDATE`,
        [userId],
      );
      const user = before.rows[0];
      if (!user) throw new NotFoundException('User not found');
      const role = changes.role ?? user.role;
      const isActive = changes.isActive ?? user.isActive;
      // An organisation must always keep at least one active admin, or nobody could manage it.
      if (user.role === 'ADMIN' && user.isActive && (role !== 'ADMIN' || !isActive)) {
        const others = await c.query(
          `SELECT 1 FROM users WHERE org_id = $1 AND role = 'ADMIN' AND is_active AND id <> $2`,
          [user.orgId, userId],
        );
        if (!others.rowCount) {
          throw new BadRequestException('The organisation would be left without an active admin');
        }
      }
      await c.query('UPDATE users SET role = $2, is_active = $3 WHERE id = $1', [userId, role, isActive]);
      let revoked: string[] = [];
      // A new role or a deactivation must not wait for the user's old tokens to run out.
      if (role !== user.role || !isActive) {
        const result = await c.query<{ familyId: string }>(
          `UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL
           RETURNING family_id AS "familyId"`,
          [userId],
        );
        revoked = [...new Set(result.rows.map((r) => r.familyId))];
      }
      await this.audit(c, admin, 'USER_UPDATED', {
        orgId: user.orgId,
        type: 'user',
        id: userId,
        details: {
          email: user.email,
          before: { role: user.role, isActive: user.isActive },
          after: { role, isActive },
        },
      });
      return revoked;
    });
    await this.revocation.revokeSessions(sids);
    return { ok: true };
  }
}
