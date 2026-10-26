import { Injectable, Module, OnModuleInit } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { SlaModule } from '../sla/sla.module.js';
import { SlaService } from '../sla/sla.service.js';
import { AuditSinkService } from './audit-sink.service.js';
import { TOPICS } from './events.js';
import { KafkaService } from './kafka.service.js';
import { MailerService } from './mailer.service.js';
import { NotificationsService } from './notifications.service.js';
import { OutboxRelayService } from './outbox-relay.service.js';

/** Starts the three consumer groups of the plan: notifications, SLA timers, and the audit sink. */
@Injectable()
export class EventConsumers implements OnModuleInit {
  private started: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly kafka: KafkaService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditSinkService,
    private readonly sla: SlaService,
  ) {}

  onModuleInit() {
    if (!this.kafka.enabled) return;
    this.started = Promise.all([
      this.kafka.startConsumer(
        'notifications',
        [TOPICS.TICKET_CREATED, TOPICS.SLA_BREACHED],
        (event) => this.notifications.handle(event),
      ),
      this.kafka.startConsumer('audit', [TOPICS.TICKET_CREATED], (event) =>
        this.audit.handle(event),
      ),
      this.kafka.startConsumer(
        'sla',
        [TOPICS.TICKET_CREATED],
        async (event) => {
          if (event.type !== TOPICS.TICKET_CREATED) return;
          const { data } = event as typeof event & {
            data: { ticketId: string; slaDeadline: string };
          };
          await this.sla.register(
            event.orgId,
            data.ticketId,
            new Date(data.slaDeadline),
          );
        },
      ),
    ]);
  }

  /** Resolves when every consumer group has joined (used by tests, so they do not publish too early). */
  ready() {
    return this.started;
  }
}

@Module({
  imports: [DatabaseModule, RealtimeModule, SlaModule],
  providers: [
    KafkaService,
    MailerService,
    OutboxRelayService,
    NotificationsService,
    AuditSinkService,
    EventConsumers,
  ],
  exports: [KafkaService, OutboxRelayService, EventConsumers],
})
export class EventsModule {}
