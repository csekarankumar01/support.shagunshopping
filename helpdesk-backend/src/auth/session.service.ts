import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DatabaseService } from '../database/database.service.js';
import type { TenantQuery } from '../database/database.service.js';
import { RevocationService } from './revocation.service.js';
import type { Role } from './role.js';

/** A refresh token is good for 14 days from its last use, but a login session never lasts longer than 30 days. */
const REFRESH_DAYS = 14;
const SESSION_MAX_DAYS = 30;
/**
 * Two requests can refresh with the same token at the same moment (two tabs, or a page and its prefetches).
 * Within this window a rotated token is still accepted once more instead of being treated as stolen.
 */
const REUSE_GRACE_SECONDS = 10;

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  /** Lifetime of the access token in seconds. */
  expiresIn: number;
}

interface SessionUser {
  id: string;
  orgId: string;
  role: Role;
}

const sha256 = (text: string) =>
  createHash('sha256').update(text).digest('hex');
const TOKEN_FORMAT =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/;

/** Splits "<orgId>.<secret>" so the tenant is known before the table is touched. Null if it is not that shape. */
export function parseOpaqueToken(raw: unknown) {
  const match = typeof raw === 'string' ? TOKEN_FORMAT.exec(raw) : null;
  return match ? { orgId: match[1], hash: sha256(raw as string) } : null;
}

/** Creates an unguessable token that starts with the org id. Only its hash is ever stored. */
export function newOpaqueToken(orgId: string) {
  const raw = `${orgId}.${randomBytes(32).toString('base64url')}`;
  return { raw, hash: sha256(raw) };
}

/**
 * Login sessions: a short-lived access token plus a rotating refresh token.
 *  - The access token (about 15 minutes) is what every API call carries. It names its session (`sid`).
 *  - The refresh token (opaque, stored hashed) is exchanged for a new pair; each is single use.
 *  - Using an old refresh token again after the grace period means it leaked: the whole session is revoked.
 *  - Ending a session records its `sid` in Redis (RevocationService), which cuts off its access tokens at once.
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly db: DatabaseService,
    private readonly jwt: JwtService,
    private readonly revocation: RevocationService,
  ) {}

  /** Starts a new login session (a new family of refresh tokens). */
  start(q: TenantQuery, user: SessionUser): Promise<Tokens> {
    return this.issue(q, user, randomUUID(), new Date());
  }

  private async issue(
    q: TenantQuery,
    user: SessionUser,
    familyId: string,
    familyStartedAt: Date,
  ): Promise<Tokens> {
    const refresh = newOpaqueToken(user.orgId);
    const hardStop = familyStartedAt.getTime() + SESSION_MAX_DAYS * 86_400_000;
    const expiresAt = new Date(
      Math.min(Date.now() + REFRESH_DAYS * 86_400_000, hardStop),
    );
    await q(
      `INSERT INTO refresh_tokens (org_id, user_id, family_id, family_started_at, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [user.id, familyId, familyStartedAt, refresh.hash, expiresAt],
    );
    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      orgId: user.orgId,
      role: user.role,
      sid: familyId,
    });
    const { exp, iat } = this.jwt.decode<{ exp: number; iat: number }>(
      accessToken,
    );
    return { accessToken, refreshToken: refresh.raw, expiresIn: exp - iat };
  }

  /** Exchanges a refresh token for a new pair. Every failure looks the same to the caller. */
  async refresh(raw: unknown): Promise<Tokens> {
    const parsed = parseOpaqueToken(raw);
    if (!parsed) throw new UnauthorizedException('Invalid or expired session');

    const outcome = await this.db.tenantTransaction(parsed.orgId, async (q) => {
      const { rows } = await q<{
        id: string;
        userId: string;
        familyId: string;
        familyStartedAt: Date;
        expired: boolean;
        revoked: boolean;
        rotatedSecondsAgo: number | null;
      }>(
        `SELECT id, user_id AS "userId", family_id AS "familyId", family_started_at AS "familyStartedAt",
                expires_at < now() AS expired, revoked_at IS NOT NULL AS revoked,
                extract(epoch FROM now() - rotated_at)::float8 AS "rotatedSecondsAgo"
           FROM refresh_tokens WHERE org_id = $1 AND token_hash = $2 FOR UPDATE`,
        [parsed.hash],
      );
      const token = rows[0];
      if (!token || token.revoked || token.expired)
        return { kind: 'denied' as const };

      if (
        token.rotatedSecondsAgo !== null &&
        token.rotatedSecondsAgo > REUSE_GRACE_SECONDS
      ) {
        // An already-used token came back after the grace period: treat the session as stolen.
        await this.revokeFamily(q, token.familyId);
        return { kind: 'reuse' as const, familyId: token.familyId };
      }

      const users = await q<{ id: string; role: Role; isActive: boolean }>(
        `SELECT id, role, is_active AS "isActive" FROM users WHERE org_id = $1 AND id = $2`,
        [token.userId],
      );
      const user = users.rows[0];
      if (!user?.isActive) {
        await this.revokeFamily(q, token.familyId);
        return { kind: 'reuse' as const, familyId: token.familyId };
      }

      await q(
        `UPDATE refresh_tokens SET rotated_at = COALESCE(rotated_at, now()) WHERE org_id = $1 AND id = $2`,
        [token.id],
      );
      // The role is read fresh here, so a role change takes effect at the next refresh at the latest.
      const tokens = await this.issue(
        q,
        { id: user.id, orgId: parsed.orgId, role: user.role },
        token.familyId,
        token.familyStartedAt,
      );
      return { kind: 'ok' as const, tokens };
    });

    if (outcome.kind === 'reuse')
      await this.revocation.revokeSessions([outcome.familyId]);
    if (outcome.kind !== 'ok')
      throw new UnauthorizedException('Invalid or expired session');
    return outcome.tokens;
  }

  /** Ends the session this refresh token belongs to (log out). Silent if the token is unknown. */
  async logout(raw: unknown) {
    const parsed = parseOpaqueToken(raw);
    if (!parsed) return;
    const sids = await this.db.tenantTransaction(parsed.orgId, async (q) => {
      const { rows } = await q<{ familyId: string }>(
        `SELECT family_id AS "familyId" FROM refresh_tokens WHERE org_id = $1 AND token_hash = $2`,
        [parsed.hash],
      );
      if (!rows[0]) return [];
      await this.revokeFamily(q, rows[0].familyId);
      return [rows[0].familyId];
    });
    await this.revocation.revokeSessions(sids);
  }

  /** Ends every session of a user, optionally keeping one (the one making the request). */
  async revokeUserSessions(orgId: string, userId: string, exceptSid?: string) {
    const sids = await this.db.tenantTransaction(orgId, (q) =>
      this.revokeAllOf(q, userId, exceptSid),
    );
    await this.revocation.revokeSessions(sids);
  }

  /** Same, inside a transaction the caller already has. Returns the session ids; the caller then calls announce(). */
  async revokeAllOf(
    q: TenantQuery,
    userId: string,
    exceptSid?: string,
  ): Promise<string[]> {
    const { rows } = await q<{ familyId: string }>(
      `UPDATE refresh_tokens SET revoked_at = now()
        WHERE org_id = $1 AND user_id = $2 AND revoked_at IS NULL AND ($3::uuid IS NULL OR family_id <> $3::uuid)
       RETURNING family_id AS "familyId"`,
      [userId, exceptSid ?? null],
    );
    return [...new Set(rows.map((row) => row.familyId))];
  }

  /** Puts sessions on the revocation list (after the database change has committed). */
  announce(sids: string[]) {
    return this.revocation.revokeSessions(sids);
  }

  private async revokeFamily(q: TenantQuery, familyId: string) {
    await q(
      `UPDATE refresh_tokens SET revoked_at = now() WHERE org_id = $1 AND family_id = $2 AND revoked_at IS NULL`,
      [familyId],
    );
  }
}
