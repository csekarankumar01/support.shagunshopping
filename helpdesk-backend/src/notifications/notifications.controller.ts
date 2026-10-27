import { Controller, Get, Module, UseGuards } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { DatabaseModule } from '../database/database.module.js';
import { DatabaseService } from '../database/database.service.js';

/** The emails the system has sent (or failed to send) for this organisation: the admin's delivery log. */
@Controller('api/v1/notifications')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class NotificationsController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser) {
    const { rows } = await this.db.tenantQuery(
      user.orgId,
      `SELECT id, ticket_id AS "ticketId", kind, recipient_email AS "recipientEmail", subject, status,
              attempts, last_error AS "lastError", created_at AS "createdAt", sent_at AS "sentAt"
         FROM notifications WHERE org_id = $1 ORDER BY created_at DESC LIMIT 100`,
    );
    return rows;
  }
}

/** Events this organisation's consumers gave up on after retrying (the admin's "failed events" list). */
@Controller('api/v1/dead-letters')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class DeadLettersController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser) {
    const { rows } = await this.db.tenantQuery(
      user.orgId,
      `SELECT id, consumer, topic, event_id AS "eventId", event_type AS "eventType", error, attempts,
              created_at AS "createdAt"
         FROM dead_letters WHERE org_id = $1 ORDER BY created_at DESC LIMIT 100`,
    );
    return rows;
  }
}

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [NotificationsController, DeadLettersController],
})
export class NotificationsModule {}
