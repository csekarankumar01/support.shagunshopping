import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard.js';
import type { Role } from '../auth/role.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { DatabaseService } from '../database/database.service.js';
import { PresenceService } from './presence.service.js';

@Controller('api/v1/presence')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'AGENT')
export class PresenceController {
  constructor(
    private readonly presence: PresenceService,
    private readonly db: DatabaseService,
  ) {}

  /** Staff of the caller's own organisation who are online right now. Customers cannot ask. */
  @Get()
  async online(@CurrentUser() user: AuthenticatedUser) {
    const ids = await this.presence.listOnline(user.orgId);
    if (!ids.length) return [];
    const { rows } = await this.db.tenantQuery<{
      userId: string;
      email: string;
      role: Role;
    }>(
      user.orgId,
      `SELECT id AS "userId", email, role FROM users
        WHERE org_id = $1 AND id = ANY($2::uuid[]) ORDER BY email`,
      [ids],
    );
    return rows;
  }
}
