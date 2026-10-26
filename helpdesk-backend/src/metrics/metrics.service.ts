import { Injectable } from '@nestjs/common';
import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';
import { DatabaseService } from '../database/database.service.js';

/**
 * Numbers for monitoring (Prometheus format at GET /api/v1/metrics). Everything is counted without tenant names or
 * ids in the labels, so the endpoint reveals how busy the system is and nothing about who uses it.
 */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  readonly httpRequests = new Counter({
    name: 'helpdesk_http_requests_total',
    help: 'HTTP requests handled',
    labelNames: ['method', 'route', 'status'],
    registers: [this.registry],
  });

  readonly httpDuration = new Histogram({
    name: 'helpdesk_http_request_duration_seconds',
    help: 'HTTP request duration',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [this.registry],
  });

  readonly websocketConnections = new Gauge({
    name: 'helpdesk_websocket_connections',
    help: 'Open WebSocket connections on this instance',
    registers: [this.registry],
  });

  readonly eventsPublished = new Counter({
    name: 'helpdesk_events_published_total',
    help: 'Events sent from the outbox to Kafka',
    labelNames: ['topic'],
    registers: [this.registry],
  });

  readonly eventsConsumed = new Counter({
    name: 'helpdesk_events_consumed_total',
    help: 'Events handled by a consumer, by outcome (ok, retry, dead_letter)',
    labelNames: ['consumer', 'outcome'],
    registers: [this.registry],
  });

  readonly slaBreaches = new Counter({
    name: 'helpdesk_sla_breaches_total',
    help: 'Tickets flagged as having missed their SLA',
    registers: [this.registry],
  });

  constructor(private readonly db: DatabaseService) {
    collectDefaultMetrics({ register: this.registry, prefix: 'helpdesk_' });
    // Read at scrape time, so the numbers are current without any background polling.
    const db_ = this.db;
    new Gauge({
      name: 'helpdesk_outbox_pending',
      help: 'Events saved but not yet published to Kafka',
      registers: [this.registry],
      async collect() {
        this.set(await backlog(db_, 'pending'));
      },
    });
    new Gauge({
      name: 'helpdesk_outbox_oldest_seconds',
      help: 'Age of the oldest event still waiting to be published',
      registers: [this.registry],
      async collect() {
        this.set(await backlog(db_, 'oldest_seconds'));
      },
    });
  }
}

async function backlog(
  db: DatabaseService,
  column: 'pending' | 'oldest_seconds',
) {
  try {
    const { rows } = await db.query<{
      pending: string;
      oldest_seconds: number;
    }>('SELECT pending, oldest_seconds FROM outbox_backlog()');
    return Number(rows[0]?.[column] ?? 0);
  } catch {
    return Number.NaN; // the scrape still works; this one number reads as "unknown"
  }
}
