import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import { DatabaseService } from '../database/database.service.js';
import { enqueueEvent, TOPICS } from '../events/events.js';
import { MetricsService } from '../metrics/metrics.service.js';
import { REDIS } from '../redis/redis.module.js';

/** Redis sorted set of running SLA timers: member `{orgId}:{ticketId}`, score = deadline in unix milliseconds. */
export const SLA_KEY = 'sla:active_timers';
const BATCH = 100;

/**
 * The SLA engine (plan workflow B).
 *  - register():  a new ticket's deadline goes into the sorted set (ZADD).
 *  - cancel():    a public staff reply, or resolving/closing the ticket, removes it (ZREM).
 *  - checkOnce(): every 10 seconds, ZRANGEBYSCORE finds timers whose deadline has passed. Postgres is touched only
 *                 for a real breach: flag the ticket, escalate its priority, write an audit row and an outbox
 *                 event (`sla.breached`), which the notification consumer turns into a live alert and emails.
 * Breaching is idempotent (the UPDATE only matches a ticket not yet breached and not yet answered) and the timer is
 * removed only after the breach is committed, so a crash or two instances never lose or double-count one.
 */
@Injectable()
export class SlaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SlaService.name);
  private timer?: ReturnType<typeof setInterval>;
  private reconcileTimer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
  ) {}

  onModuleInit() {
    if (this.config.get<string>('EVENTS_ENABLED', 'true') === 'false') return;
    const every = Number(
      this.config.get<string>('SLA_CHECK_INTERVAL_MS', '10000'),
    );
    this.timer = setInterval(() => void this.tick(), every);
    this.timer.unref();
    // Rebuild timers from the tickets shortly after start (Redis may have lost its data while the API was down) and
    // then regularly, so a lost or missed timer is never permanent.
    const reconcileEvery = Number(
      this.config.get<string>('SLA_RECONCILE_INTERVAL_MS', '600000'),
    );
    this.reconcileTimer = setInterval(
      () => void this.safeReconcile(),
      reconcileEvery,
    );
    this.reconcileTimer.unref();
    const first = setTimeout(() => void this.safeReconcile(), 5000);
    first.unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
    clearInterval(this.reconcileTimer);
  }

  async register(orgId: string, ticketId: string, deadline: Date) {
    await this.redis.zadd(SLA_KEY, deadline.getTime(), `${orgId}:${ticketId}`);
  }

  /** Never throws: a Redis hiccup must not fail the reply or status change that triggered it. */
  async cancel(orgId: string, ticketId: string) {
    try {
      await this.redis.zrem(SLA_KEY, `${orgId}:${ticketId}`);
    } catch (err) {
      this.logger.warn(`could not cancel SLA timer: ${(err as Error).message}`);
    }
  }

  private async tick() {
    if (this.running) return; // never overlap with a slow previous pass
    this.running = true;
    try {
      await this.checkOnce();
    } catch (err) {
      this.logger.warn(`SLA check failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * Puts back any running timer that is missing from Redis, using the tickets themselves as the source of truth
   * (open or in progress, no public staff reply yet, not breached). NX: an existing timer is never touched.
   * Returns how many timers were restored. Public so tests can drive it.
   */
  async reconcile(limit = 5000): Promise<number> {
    const { rows } = await this.db.query<{
      org_id: string;
      ticket_id: string;
      sla_deadline: Date;
    }>('SELECT org_id, ticket_id, sla_deadline FROM sla_pending_timers($1)', [
      limit,
    ]);
    if (!rows.length) return 0;
    const pipeline = this.redis.pipeline();
    for (const row of rows) {
      pipeline.zadd(
        SLA_KEY,
        'NX',
        row.sla_deadline.getTime(),
        `${row.org_id}:${row.ticket_id}`,
      );
    }
    const results = (await pipeline.exec()) ?? [];
    const restored = results.reduce((sum, [, added]) => sum + Number(added), 0);
    if (restored > 0)
      this.logger.warn(
        `restored ${restored} missing SLA timer(s) from the database`,
      );
    return restored;
  }

  private async safeReconcile() {
    try {
      await this.reconcile();
    } catch (err) {
      this.logger.warn(`SLA reconcile failed: ${(err as Error).message}`);
    }
  }

  /** One pass over the overdue timers. Returns how many tickets were newly breached. Public so tests can drive it. */
  async checkOnce(now = Date.now()): Promise<number> {
    const due = await this.redis.zrangebyscore(
      SLA_KEY,
      '-inf',
      now,
      'LIMIT',
      0,
      BATCH,
    );
    let breached = 0;
    for (const member of due) {
      const [orgId, ticketId] = member.split(':');
      try {
        const outcome = await this.breach(orgId, ticketId);
        if (outcome === 'breached') breached += 1;
        // 'not-due': Redis and the database disagree about the clock. The database is right; keep the timer.
        if (outcome !== 'not-due') await this.redis.zrem(SLA_KEY, member);
      } catch (err) {
        this.logger.warn(
          `breach of ${member} failed, will retry: ${(err as Error).message}`,
        );
      }
    }
    return breached;
  }

  private breach(
    orgId: string,
    ticketId: string,
  ): Promise<'breached' | 'done' | 'not-due'> {
    return this.db.tenantTransaction(orgId, async (q) => {
      const { rows } = await q<{
        oldPriority: string;
        newPriority: string;
        subject: string;
        agentId: string | null;
        slaDeadline: Date;
        breachedAt: Date;
      }>(
        `WITH t AS (
           SELECT id, priority FROM tickets
            WHERE org_id = $1 AND id = $2
              AND sla_breached_at IS NULL AND first_response_at IS NULL
              AND status IN ('OPEN', 'IN_PROGRESS') AND sla_deadline <= now()
              FOR UPDATE)
         UPDATE tickets k
            SET sla_breached_at = now(), updated_at = now(),
                priority = CASE t.priority WHEN 'LOW' THEN 'MEDIUM' WHEN 'MEDIUM' THEN 'HIGH' ELSE 'URGENT' END
           FROM t
          WHERE k.org_id = $1 AND k.id = t.id
      RETURNING t.priority AS "oldPriority", k.priority AS "newPriority", k.subject,
                k.agent_id AS "agentId", k.sla_deadline AS "slaDeadline", k.sla_breached_at AS "breachedAt"`,
        [ticketId],
      );
      const hit = rows[0];
      if (!hit) {
        // Nothing to breach: either the ticket was answered, closed or already handled (the timer is finished),
        // or its deadline has not really passed yet (the timer must stay).
        const waiting = await q(
          `SELECT 1 FROM tickets
            WHERE org_id = $1 AND id = $2 AND sla_breached_at IS NULL AND first_response_at IS NULL
              AND status IN ('OPEN', 'IN_PROGRESS') AND sla_deadline > now()`,
          [ticketId],
        );
        return waiting.rowCount ? 'not-due' : 'done';
      }
      await q(
        `INSERT INTO audit_logs (org_id, ticket_id, actor_id, action, old_val, new_val)
         VALUES ($1, $2, NULL, 'SLA_BREACHED', $3, $4)`,
        [ticketId, hit.oldPriority, hit.newPriority],
      );
      await enqueueEvent(q, TOPICS.SLA_BREACHED, {
        ticketId,
        subject: hit.subject,
        oldPriority: hit.oldPriority,
        newPriority: hit.newPriority,
        agentId: hit.agentId,
        slaDeadline: hit.slaDeadline.toISOString(),
        breachedAt: hit.breachedAt.toISOString(),
      });
      this.metrics.slaBreaches.inc();
      return 'breached';
    });
  }
}
