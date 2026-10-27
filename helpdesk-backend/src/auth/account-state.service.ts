import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import type { AuthenticatedUser } from './verify-token.js';

/** How long one answer is reused. Short, so a change made directly in the database takes effect within seconds. */
const TTL_MS = 5_000;
const MAX_ENTRIES = 10_000;

/**
 * Is this token still describing a real, allowed account? A token can be perfectly signed and unexpired and still be
 * out of date, because someone changed the database underneath it (a person switched off, an organisation suspended,
 * a role changed) without going through the app, so no session was revoked. This is the check that catches it:
 * the user must still exist, be active, belong to an organisation that is not suspended, and still have the role
 * the token claims (a different role means the token must be renewed, and renewing reads the new role).
 *
 * One small indexed query, reused for a few seconds per user, so it adds almost nothing to a request.
 */
@Injectable()
export class AccountStateService {
  private readonly cache = new Map<string, { ok: boolean; until: number }>();

  constructor(private readonly db: DatabaseService) {}

  async isCurrent(user: AuthenticatedUser): Promise<boolean> {
    const key = `${user.orgId}:${user.userId}:${user.role}`;
    const hit = this.cache.get(key);
    if (hit && hit.until > Date.now()) return hit.ok;

    const { rows } = await this.db.tenantQuery<{ ok: boolean }>(
      user.orgId,
      `SELECT (u.is_active AND o.suspended_at IS NULL AND u.role = $3) AS ok
         FROM users u JOIN organizations o ON o.id = u.org_id
        WHERE u.org_id = $1 AND u.id = $2`,
      [user.userId, user.role],
    );
    const ok = rows[0]?.ok === true;
    if (this.cache.size >= MAX_ENTRIES) this.cache.clear();
    this.cache.set(key, { ok, until: Date.now() + TTL_MS });
    return ok;
  }
}
