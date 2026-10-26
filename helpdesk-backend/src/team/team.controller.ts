import { Controller, Get, Module, UseGuards } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard.js';
import type { Role } from '../auth/role.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { DatabaseModule } from '../database/database.module.js';
import { DatabaseService } from '../database/database.service.js';

@Controller('api/v1/team')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'AGENT')
export class TeamController {
  constructor(private readonly db: DatabaseService) {}

  /**
   * The caller's own organisation's people. Agents see the staff (who they can assign tickets to);
   * admins also see the customers. The password hash is never selected.
   */
  @Get()
  async members(@CurrentUser() user: AuthenticatedUser) {
    const staffOnly =
      user.role === 'AGENT' ? `AND role IN ('ADMIN', 'AGENT')` : '';
    const { rows } = await this.db.tenantQuery<{
      userId: string;
      email: string;
      role: Role;
      createdAt: Date;
    }>(
      user.orgId,
      `SELECT id AS "userId", email, role, created_at AS "createdAt"
         FROM users WHERE org_id = $1 ${staffOnly}
        ORDER BY CASE role WHEN 'ADMIN' THEN 0 WHEN 'AGENT' THEN 1 ELSE 2 END, email`,
    );
    return rows;
  }
}

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [TeamController],
})
export class TeamModule {}
