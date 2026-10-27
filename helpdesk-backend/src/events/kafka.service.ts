import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Admin,
  Consumer,
  Producer,
  stringDeserializers,
  stringSerializers,
} from '@platformatic/kafka';
import { DatabaseService } from '../database/database.service.js';
import { MetricsService } from '../metrics/metrics.service.js';
import { TOPICS } from './events.js';
import type { EventEnvelope, Topic } from './events.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const MAX_ATTEMPTS = 4;

export interface OutgoingMessage {
  topic: string;
  key: string;
  value: string;
}

export type EventHandler = (event: EventEnvelope) => Promise<void>;

/**
 * Kafka (Redpanda in development): topics, a producer, and consumers that survive trouble.
 *  - A handler that throws is retried (0.5 s, 1 s, 2 s...). If it still fails the message goes to `<topic>.dlq`
 *    and processing continues, so one bad message cannot block a tenant's queue forever.
 *  - Offsets are committed only after a message has been handled: delivery is at-least-once, so every handler
 *    must be idempotent.
 *  - A dropped broker connection restarts the consumer instead of killing the process.
 */
@Injectable()
export class KafkaService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(KafkaService.name);
  private readonly brokers: string[];
  private readonly clientId = 'helpdesk-api';
  private readonly groupPrefix: string;
  private readonly topicPrefix: string;
  private readonly fallbackMode: 'earliest' | 'latest';
  private producer?: Producer<string, string, string, string>;
  private readonly consumers: Consumer<string, string, string, string>[] = [];
  private stopping = false;
  readonly enabled: boolean;

  constructor(
    config: ConfigService,
    private readonly metrics: MetricsService,
    private readonly db: DatabaseService,
  ) {
    this.enabled = config.get<string>('EVENTS_ENABLED', 'true') !== 'false';
    this.brokers = config
      .get<string>('KAFKA_BROKERS', 'localhost:4092')
      .split(',')
      .map((broker) => broker.trim());
    this.groupPrefix = config.get<string>('KAFKA_GROUP_PREFIX', 'helpdesk');
    // Tests publish to their own topics ("test.ticket.created"), so they never mix with real events.
    this.topicPrefix = config.get<string>('KAFKA_TOPIC_PREFIX', '');
    // A new consumer group starts at the beginning, so an event published before its first start is not skipped.
    this.fallbackMode =
      config.get<string>('KAFKA_FALLBACK_MODE', 'earliest') === 'latest'
        ? 'latest'
        : 'earliest';
  }

  onModuleInit() {
    if (!this.enabled) return;
    void this.ensureTopics(); // in the background: the API must start even when the broker is down
  }

  async onApplicationShutdown() {
    this.stopping = true;
    await Promise.allSettled([
      ...this.consumers.map((consumer) => consumer.close(true)),
      this.producer?.close(true),
    ]);
  }

  private async ensureTopics() {
    const topics = Object.values(TOPICS).flatMap((t) => [
      this.topicName(t),
      `${this.topicName(t)}.dlq`,
    ]);
    for (let attempt = 1; !this.stopping; attempt++) {
      const admin = new Admin({
        clientId: this.clientId,
        bootstrapBrokers: this.brokers,
      });
      try {
        const existing = await admin.listTopics();
        const missing = topics.filter((topic) => !existing.includes(topic));
        if (missing.length) {
          await admin.createTopics({
            topics: missing,
            partitions: 3,
            replicas: 1,
          });
          this.logger.log(`Created topics: ${missing.join(', ')}`);
        }
        await admin.close();
        return;
      } catch (err) {
        await admin.close().catch(() => undefined);
        this.logger.warn(
          `Kafka not ready (attempt ${attempt}): ${(err as Error).message}`,
        );
        await sleep(Math.min(1000 * attempt, 10_000));
      }
    }
  }

  /** The real Kafka topic for an event type, e.g. "ticket.created" (or "test.ticket.created" in tests). */
  topicName(eventType: string) {
    return `${this.topicPrefix}${eventType}`;
  }

  async send(messages: OutgoingMessage[]) {
    if (!this.producer) {
      this.producer = new Producer({
        clientId: this.clientId,
        bootstrapBrokers: this.brokers,
        serializers: stringSerializers,
      });
    }
    await this.producer.send({ messages });
  }

  /** Starts a consumer group in the background. Resolves once the first attempt has joined (or failed to). */
  startConsumer(
    name: string,
    topics: Topic[],
    handler: EventHandler,
  ): Promise<void> {
    const groupId = `${this.groupPrefix}.${name}`;
    let ready!: () => void;
    const firstJoin = new Promise<void>((resolve) => (ready = resolve));
    void (async () => {
      while (!this.stopping) {
        const consumer = new Consumer({
          groupId,
          clientId: `${this.clientId}-${name}`,
          bootstrapBrokers: this.brokers,
          deserializers: stringDeserializers,
          sessionTimeout: 10_000,
          heartbeatInterval: 1_000,
        });
        this.consumers.push(consumer);
        try {
          const stream = await consumer.consume({
            topics: topics.map((topic) => this.topicName(topic)),
            mode: 'committed',
            fallbackMode: this.fallbackMode,
            autocommit: false,
          });
          this.logger.log(
            `Consumer "${groupId}" listening to ${topics.join(', ')}`,
          );
          ready();
          for await (const message of stream) {
            await this.handle(name, message.topic, message.value, handler);
            await message.commit();
          }
        } catch (err) {
          if (!this.stopping) {
            this.logger.warn(
              `Consumer "${groupId}" stopped (${(err as Error).message}); restarting`,
            );
          }
        } finally {
          this.consumers.splice(this.consumers.indexOf(consumer), 1);
          await consumer.close(true).catch(() => undefined);
        }
        ready(); // never leave a caller waiting forever
        if (!this.stopping) await sleep(2000);
      }
    })();
    return firstJoin;
  }

  private async handle(
    name: string,
    topic: string,
    raw: string,
    handler: EventHandler,
  ) {
    let event: EventEnvelope;
    try {
      event = JSON.parse(raw) as EventEnvelope;
    } catch {
      this.logger.error(
        `[${name}] unreadable message on ${topic}; sent to DLQ`,
      );
      return this.deadLetter(topic, raw);
    }
    for (let attempt = 1; ; attempt++) {
      let failure: Error;
      try {
        await handler(event);
        this.metrics.eventsConsumed.inc({ consumer: name, outcome: 'ok' });
        return;
      } catch (err) {
        failure = err as Error;
        this.logger.warn(
          `[${name}] ${event.type} ${event.id} failed (attempt ${attempt}/${MAX_ATTEMPTS}): ${(err as Error).message}`,
        );
        if (attempt >= MAX_ATTEMPTS) {
          this.metrics.eventsConsumed.inc({
            consumer: name,
            outcome: 'dead_letter',
          });
          this.logger.error(`[${name}] giving up on ${event.id}; sent to DLQ`);
          return this.deadLetter(topic, raw, event.orgId, {
            consumer: name,
            event,
            error: failure.message,
            attempts: attempt,
          });
        }
        await sleep(500 * 2 ** (attempt - 1));
      }
    }
  }

  private async deadLetter(
    topic: string,
    raw: string,
    key = 'unknown',
    failed?: {
      consumer: string;
      event: EventEnvelope;
      error: string;
      attempts: number;
    },
  ) {
    try {
      await this.send([{ topic: `${topic}.dlq`, key, value: raw }]);
    } catch (err) {
      this.logger.error(
        `could not write to ${topic}.dlq: ${(err as Error).message}`,
      );
    }
    if (failed) await this.recordDeadLetter(topic, raw, failed);
  }

  /** Keeps a readable copy for the organisation's admin. Best effort: a failure here must not stop the consumer. */
  private async recordDeadLetter(
    topic: string,
    raw: string,
    { consumer, event, error, attempts }: {
      consumer: string;
      event: EventEnvelope;
      error: string;
      attempts: number;
    },
  ) {
    try {
      await this.db.tenantQuery(
        event.orgId,
        `INSERT INTO dead_letters (org_id, consumer, topic, event_id, event_type, error, attempts, payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (consumer, event_id) DO NOTHING`,
        [consumer, topic, event.id, event.type, error.slice(0, 1000), attempts, raw],
      );
    } catch (err) {
      this.logger.error(
        `could not record dead letter ${event.id}: ${(err as Error).message}`,
      );
    }
  }
}
