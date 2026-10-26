import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { KafkaService } from './kafka.service.js';

const BATCH = 50;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface OutboxRow {
  id: string;
  topic: string;
  event_key: string;
  payload: Record<string, unknown>;
}

/**
 * Publishes outbox rows to Kafka. A claimed row is leased for 30 seconds; it is deleted only after Kafka has
 * accepted it. If the process dies in between, the lease runs out and the row is sent again (at-least-once).
 * Rows are sent in id order, which keeps one tenant's events in the order they were committed.
 */
@Injectable()
export class OutboxRelayService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxRelayService.name);
  private stopping = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly kafka: KafkaService,
  ) {}

  onModuleInit() {
    if (!this.kafka.enabled) return;
    void this.loop();
  }

  onApplicationShutdown() {
    this.stopping = true;
  }

  private async loop() {
    let failures = 0;
    while (!this.stopping) {
      try {
        const sent = await this.relayOnce();
        failures = 0;
        if (sent === BATCH) continue; // more waiting: no pause
        await sleep(300);
      } catch (err) {
        failures += 1;
        this.logger.warn(
          `relay failed (${failures}): ${(err as Error).message}`,
        );
        await sleep(Math.min(500 * 2 ** failures, 15_000));
      }
    }
  }

  /** One pass. Returns how many events were published. Public so tests can drive it. */
  async relayOnce(): Promise<number> {
    const { rows } = await this.db.query<OutboxRow>(
      'SELECT id, topic, event_key, payload FROM outbox_claim($1)',
      [BATCH],
    );
    if (!rows.length) return 0;
    rows.sort((a, b) => Number(BigInt(a.id) - BigInt(b.id)));
    await this.kafka.send(
      rows.map((row) => ({
        topic: this.kafka.topicName(row.topic),
        key: row.event_key,
        value: JSON.stringify({
          id: row.id,
          orgId: row.event_key,
          ...row.payload,
        }),
      })),
    );
    await this.db.query('SELECT outbox_complete($1::bigint[])', [
      rows.map((row) => row.id),
    ]);
    return rows.length;
  }
}
