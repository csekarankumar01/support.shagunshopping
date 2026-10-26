import { randomBytes } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Consumer, stringDeserializers } from '@platformatic/kafka';
import { Redis } from 'ioredis';
import pg from 'pg';
import { io, Socket } from 'socket.io-client';
import { vi } from 'vitest';
import { EventConsumers } from '../src/events/events.module.js';
import { KafkaService } from '../src/events/kafka.service.js';
import { MailerService } from '../src/events/mailer.service.js';
import { SLA_KEY, SlaService } from '../src/sla/sla.service.js';
import {
  auth,
  createTenant,
  createTestApp,
  deleteTenants,
  http,
  ownerPool,
  Tenant,
} from './helpers.js';

const API = '/api/v1';
const run = randomBytes(3).toString('hex'); // makes every subject in this run unique
const MAIL = `http://localhost:${process.env.MAIL_UI_PORT ?? 4026}`;

// Turned on before the app is created: this is the one test file that uses the broker.
process.env.EVENTS_ENABLED = 'true';
process.env.KAFKA_GROUP_PREFIX = `test-${run}`;
process.env.KAFKA_FALLBACK_MODE = 'latest'; // do not replay earlier runs' history
process.env.SLA_CHECK_INTERVAL_MS = '3600000'; // the timer is driven by hand (checkOnce) in these tests

interface MailSummary {
  ID: string;
  Subject: string;
  To: { Address: string }[];
}

describe('events: outbox, Kafka, notifications, audit and the SLA engine', () => {
  let app: INestApplication;
  let owner: pg.Pool;
  let redis: Redis;
  let baseUrl: string;
  let kafka: KafkaService;
  let sla: SlaService;
  let a: Tenant; // normal SLA window
  let s: Tenant; // an organisation with a 1-minute SLA window; tests push chosen tickets' deadlines into the past
  const slugs: string[] = [];
  const open: Socket[] = [];
  const members: string[] = [];
  const mailIds: string[] = [];

  const until = async (
    check: () => Promise<boolean> | boolean,
    ms = 20_000,
  ) => {
    const end = Date.now() + ms;
    while (!(await check()) && Date.now() < end)
      await new Promise((r) => setTimeout(r, 100));
    expect(await check()).toBe(true);
  };
  const settle = (ms = 1500) => new Promise((r) => setTimeout(r, ms));
  /** "Now" far enough ahead that every timer counts as due in Redis; the database still decides what is overdue. */
  const FUTURE = () => Date.now() + 5 * 60_000;
  const pastDue = (...ids: string[]) =>
    owner.query(
      `UPDATE tickets SET sla_deadline = now() - interval '1 second' WHERE id = ANY($1::uuid[])`,
      [ids],
    );

  const createTicket = async (
    token: string,
    subject: string,
    priority = 'MEDIUM',
  ) => {
    const res = await http(app)
      .post(`${API}/tickets`)
      .set(auth(token))
      .send({ subject, priority });
    expect(res.status).toBe(201);
    return res.body as { id: string; priority: string; slaDeadline: string };
  };
  const query = async <T extends pg.QueryResultRow>(
    sql: string,
    params: unknown[],
  ) => (await owner.query<T>(sql, params)).rows;
  const notification = (ticketId: string) =>
    query<{
      status: string;
      attempts: number;
      recipient_email: string;
      kind: string;
    }>(
      'SELECT status, attempts, recipient_email, kind FROM notifications WHERE ticket_id = $1 ORDER BY recipient_email',
      [ticketId],
    );
  const outboxCount = async (orgId: string) =>
    (
      await query<{ n: number }>(
        'SELECT count(*)::int AS n FROM outbox_events WHERE org_id = $1',
        [orgId],
      )
    )[0].n;
  const mailFor = async (to: string, subjectPart: string) => {
    const res = await fetch(`${MAIL}/api/v1/messages?limit=500`);
    const { messages } = (await res.json()) as { messages: MailSummary[] };
    const found = messages.filter(
      (m) =>
        m.Subject.includes(subjectPart) && m.To.some((t) => t.Address === to),
    );
    mailIds.push(...found.map((m) => m.ID));
    return found;
  };
  const trackTimer = (orgId: string, ticketId: string) =>
    members.push(`${orgId}:${ticketId}`);
  const timerScore = async (orgId: string, ticketId: string) =>
    redis.zscore(SLA_KEY, `${orgId}:${ticketId}`);

  const connectAs = async (accessToken: string) => {
    const res = await http(app)
      .post(`${API}/auth/socket-token`)
      .set(auth(accessToken));
    return new Promise<Socket>((resolve, reject) => {
      const socket = io(`${baseUrl}/support`, {
        transports: ['websocket'],
        auth: { token: res.body.token },
        extraHeaders: { Origin: 'http://localhost:4311' },
        reconnection: false,
      });
      open.push(socket);
      socket.once('connect', () => resolve(socket));
      socket.once('connect_error', reject);
    });
  };

  beforeAll(async () => {
    app = await createTestApp();
    await app.listen(0);
    baseUrl = `http://localhost:${(app.getHttpServer().address() as { port: number }).port}`;
    owner = ownerPool();
    redis = new Redis({
      host: process.env.REDIS_HOST,
      port: Number(process.env.REDIS_PORT),
      password: process.env.REDIS_PASSWORD,
    });
    kafka = app.get(KafkaService);
    sla = app.get(SlaService);
    await app.get(EventConsumers).ready();
    a = await createTenant(app, 'eva');
    s = await createTenant(app, 'evs');
    slugs.push(a.slug, s.slug);
    await owner.query('UPDATE organizations SET sla_mins = 1 WHERE id = $1', [
      s.orgId,
    ]);
  }, 60_000);

  afterEach(() => {
    for (const socket of open.splice(0)) socket.close();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    if (members.length) await redis.zrem(SLA_KEY, ...members);
    await fetch(`${MAIL}/api/v1/messages`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ IDs: [...new Set(mailIds)] }),
    }).catch(() => undefined);
    redis.disconnect();
    await deleteTenants(owner, slugs);
    await owner.end();
    await app.close();
  });

  describe('creating a ticket sets everything in motion', () => {
    it('sends the receipt email, registers the SLA timer, writes the audit row, and empties the outbox', async () => {
      const agentSocket = await connectAs(a.agent);
      const customerSocket = await connectAs(a.cust1);
      const toAgent: { subject: string }[] = [];
      const toCustomer: unknown[] = [];
      agentSocket.on('ticket:created', (e) => toAgent.push(e));
      customerSocket.on('ticket:created', (e) => toCustomer.push(e));

      const subject = `Printer jam ${run}`;
      const ticket = await createTicket(a.cust1, subject);
      trackTimer(a.orgId, ticket.id);

      await until(async () =>
        (await notification(ticket.id)).some((n) => n.status === 'SENT'),
      );
      expect(await notification(ticket.id)).toEqual([
        {
          status: 'SENT',
          attempts: 1,
          recipient_email: 'cust1@x.com',
          kind: 'TICKET_RECEIPT',
        },
      ]);
      await until(
        async () => (await mailFor('cust1@x.com', subject)).length === 1,
      );
      await until(async () => (await timerScore(a.orgId, ticket.id)) !== null);
      expect(Number(await timerScore(a.orgId, ticket.id))).toBe(
        Date.parse(ticket.slaDeadline),
      );
      await until(
        async () =>
          (
            await query(
              'SELECT 1 FROM audit_logs WHERE ticket_id = $1 AND action = $2',
              [ticket.id, 'TICKET_CREATED'],
            )
          ).length === 1,
      );
      await until(async () => (await outboxCount(a.orgId)) === 0);
      await until(() => toAgent.length === 1);
      expect(toAgent[0].subject).toBe(subject);
      await settle(500);
      expect(toCustomer).toHaveLength(0); // the live "new ticket" alert is for staff only
    });

    it("keeps one organisation's events in one partition, keyed by org id", async () => {
      const seen: { key: string; partition: number }[] = [];
      const probe = new Consumer({
        groupId: `probe-${run}`,
        clientId: `probe-${run}`,
        bootstrapBrokers: (process.env.KAFKA_BROKERS ?? 'localhost:4092').split(
          ',',
        ),
        deserializers: stringDeserializers,
      });
      const stream = await probe.consume({
        topics: ['ticket.created'],
        mode: 'latest',
        autocommit: true,
      });
      void (async () => {
        for await (const message of stream)
          seen.push({ key: message.key, partition: message.partition });
      })();
      await settle(1500); // let the probe settle on its assignment

      for (const [tenant, who] of [
        [a, a.cust1],
        [s, s.cust1],
        [a, a.cust2],
        [s, s.cust2],
        [a, a.cust1],
        [s, s.cust1],
      ] as const) {
        const ticket = await createTicket(who, `Ordering ${run}`);
        trackTimer(tenant.orgId, ticket.id);
      }
      await until(() => seen.length >= 6);
      await probe.close(true);

      for (const tenant of [a, s]) {
        const mine = seen.filter((m) => m.key === tenant.orgId);
        expect(mine).toHaveLength(3);
        expect(new Set(mine.map((m) => m.partition)).size).toBe(1);
      }
    });
  });

  describe('delivery guarantees', () => {
    it('does nothing twice when the same event is delivered twice (idempotent consumers)', async () => {
      const subject = `Twice ${run}`;
      const ticket = await createTicket(a.cust2, subject);
      trackTimer(a.orgId, ticket.id);
      await until(async () =>
        (await notification(ticket.id)).some((n) => n.status === 'SENT'),
      );
      await until(
        async () => (await mailFor('cust2@x.com', subject)).length === 1,
      );

      // Replay exactly what the relay sent, as a broker redelivery would.
      await kafka.send([
        {
          topic: 'ticket.created',
          key: a.orgId,
          value: JSON.stringify({
            id: 'replayed',
            orgId: a.orgId,
            type: 'ticket.created',
            version: 1,
            occurredAt: new Date().toISOString(),
            data: {
              ticketId: ticket.id,
              requesterId: (
                await query<{ requester_id: string }>(
                  'SELECT requester_id FROM tickets WHERE id = $1',
                  [ticket.id],
                )
              )[0].requester_id,
              subject,
              priority: 'MEDIUM',
              slaDeadline: ticket.slaDeadline,
              createdAt: new Date().toISOString(),
            },
          }),
        },
      ]);
      await settle(3000);
      expect(await notification(ticket.id)).toHaveLength(1);
      expect(await mailFor('cust2@x.com', subject)).toHaveLength(1);
      expect(
        await query(
          'SELECT 1 FROM audit_logs WHERE ticket_id = $1 AND action = $2',
          [ticket.id, 'TICKET_CREATED'],
        ),
      ).toHaveLength(1);
    });

    it('still saves the ticket when the broker is down, keeps the event in the outbox, and delivers it afterwards', async () => {
      vi.spyOn(kafka, 'send').mockRejectedValue(
        new Error('broker unreachable'),
      );
      const subject = `Outage ${run}`;
      const ticket = await createTicket(a.cust1, subject); // the HTTP request does not wait for Kafka
      trackTimer(a.orgId, ticket.id);
      await settle(2000);
      expect(await outboxCount(a.orgId)).toBe(1); // safe in the database
      expect(await notification(ticket.id)).toHaveLength(0); // nothing went out

      vi.restoreAllMocks();
      await owner.query(
        'UPDATE outbox_events SET locked_until = now() WHERE org_id = $1',
        [a.orgId],
      ); // lease over
      await until(async () =>
        (await notification(ticket.id)).some((n) => n.status === 'SENT'),
      );
      await until(async () => (await outboxCount(a.orgId)) === 0);
    });

    it('retries a failing email, then gives up and dead-letters it, without blocking the next ticket or the other consumers', async () => {
      const mailer = app.get(MailerService);
      vi.spyOn(mailer, 'send').mockRejectedValue(new Error('smtp down'));
      const subject = `Mail failure ${run}`;
      const ticket = await createTicket(a.cust1, subject);
      trackTimer(a.orgId, ticket.id);
      await until(
        async () =>
          (await notification(ticket.id)).some((n) => n.status === 'FAILED'),
        30_000,
      );
      expect((await notification(ticket.id))[0].attempts).toBe(4);
      // The audit and SLA consumers are separate groups: this failure did not hold them up.
      await until(
        async () =>
          (
            await query(
              'SELECT 1 FROM audit_logs WHERE ticket_id = $1 AND action = $2',
              [ticket.id, 'TICKET_CREATED'],
            )
          ).length === 1,
      );

      vi.restoreAllMocks();
      const next = await createTicket(a.cust2, `After failure ${run}`);
      trackTimer(a.orgId, next.id);
      await until(async () =>
        (await notification(next.id)).some((n) => n.status === 'SENT'),
      );
    }, 60_000);
  });

  describe('the SLA engine', () => {
    const breaches = async (ticketId: string) =>
      query<{
        sla_breached_at: Date | null;
        priority: string;
        first_response_at: Date | null;
      }>(
        'SELECT sla_breached_at, priority, first_response_at FROM tickets WHERE id = $1',
        [ticketId],
      );

    it('leaves a ticket alone until its real deadline passes, even when Redis says it is due', async () => {
      const ticket = await createTicket(s.cust1, `Plenty of time ${run}`);
      trackTimer(s.orgId, ticket.id);
      await until(async () => (await timerScore(s.orgId, ticket.id)) !== null);
      expect(await sla.checkOnce()).toBe(0); // nothing is due: the real deadline is hours away
      await sla.checkOnce(FUTURE()); // Redis says due, the database says not yet: the database wins
      expect((await breaches(ticket.id))[0].sla_breached_at).toBeNull();
      expect(await timerScore(s.orgId, ticket.id)).not.toBeNull();
    });

    it('flags an overdue ticket, escalates its priority, audits it, alerts staff live, emails the admin, and clears the timer', async () => {
      const staffSocket = await connectAs(s.agent);
      const customerSocket = await connectAs(s.cust1);
      const alertsToStaff: { ticketId: string; priority: string }[] = [];
      const alertsToCustomer: unknown[] = [];
      staffSocket.on('sla:breached', (e) => alertsToStaff.push(e));
      customerSocket.on('sla:breached', (e) => alertsToCustomer.push(e));

      const subject = `Overdue ${run}`;
      const ticket = await createTicket(s.cust1, subject, 'MEDIUM');
      trackTimer(s.orgId, ticket.id);
      await until(async () => (await timerScore(s.orgId, ticket.id)) !== null);

      await pastDue(ticket.id);
      expect(await sla.checkOnce(FUTURE())).toBe(1);
      const [row] = await breaches(ticket.id);
      expect(row.sla_breached_at).not.toBeNull();
      expect(row.priority).toBe('HIGH'); // MEDIUM -> HIGH
      expect(await timerScore(s.orgId, ticket.id)).toBeNull();
      const audit = await query<{
        actor_id: string | null;
        old_val: string;
        new_val: string;
      }>(
        `SELECT actor_id, old_val, new_val FROM audit_logs WHERE ticket_id = $1 AND action = 'SLA_BREACHED'`,
        [ticket.id],
      );
      expect(audit).toEqual([
        { actor_id: null, old_val: 'MEDIUM', new_val: 'HIGH' },
      ]);

      await until(() => alertsToStaff.some((e) => e.ticketId === ticket.id));
      expect(
        alertsToStaff.find((e) => e.ticketId === ticket.id)?.priority,
      ).toBe('HIGH');
      await until(
        async () =>
          (await mailFor('admin@shared.com', `SLA breached: ${subject}`))
            .length === 1,
      );
      expect(
        (await notification(ticket.id))
          .filter((n) => n.kind === 'SLA_BREACH_ALERT')
          .map((n) => n.status),
      ).toEqual(['SENT']);
      expect(alertsToCustomer).toHaveLength(0);

      expect(await sla.checkOnce(FUTURE())).toBe(0); // handled once, never twice
    });

    it('a public staff reply before the deadline stops the clock; an internal note does not', async () => {
      const answered = await createTicket(
        s.cust1,
        `Answered in time ${run}`,
        'LOW',
      );
      const noted = await createTicket(s.cust2, `Only a note ${run}`, 'LOW');
      for (const t of [answered, noted]) trackTimer(s.orgId, t.id);
      await until(
        async () =>
          (await timerScore(s.orgId, answered.id)) !== null &&
          (await timerScore(s.orgId, noted.id)) !== null,
      );

      await http(app)
        .post(`${API}/tickets/${answered.id}/comments`)
        .set(auth(s.agent))
        .send({ message: 'On it' })
        .expect(201);
      await http(app)
        .post(`${API}/tickets/${noted.id}/comments`)
        .set(auth(s.agent))
        .send({ message: 'private thought', isInternalNote: true })
        .expect(201);
      expect(await timerScore(s.orgId, answered.id)).toBeNull(); // ZREM
      expect(await timerScore(s.orgId, noted.id)).not.toBeNull();
      expect((await breaches(answered.id))[0].first_response_at).not.toBeNull();
      expect((await breaches(noted.id))[0].first_response_at).toBeNull();

      await pastDue(answered.id, noted.id);
      await sla.checkOnce(FUTURE());
      expect((await breaches(answered.id))[0].sla_breached_at).toBeNull();
      expect((await breaches(noted.id))[0].sla_breached_at).not.toBeNull();
      expect((await breaches(noted.id))[0].priority).toBe('MEDIUM'); // LOW -> MEDIUM
    });

    it('a customer reply does not stop the clock, and resolving or closing a ticket does', async () => {
      const customerOnly = await createTicket(
        s.cust1,
        `Customer chatter ${run}`,
      );
      const resolved = await createTicket(s.cust2, `Resolved ${run}`);
      for (const t of [customerOnly, resolved]) trackTimer(s.orgId, t.id);
      await until(
        async () =>
          (await timerScore(s.orgId, customerOnly.id)) !== null &&
          (await timerScore(s.orgId, resolved.id)) !== null,
      );

      await http(app)
        .post(`${API}/tickets/${customerOnly.id}/comments`)
        .set(auth(s.cust1))
        .send({ message: 'hello?' })
        .expect(201);
      await http(app)
        .patch(`${API}/tickets/${resolved.id}/status`)
        .set(auth(s.agent))
        .send({ status: 'RESOLVED' })
        .expect(200);
      expect(await timerScore(s.orgId, customerOnly.id)).not.toBeNull();
      expect(await timerScore(s.orgId, resolved.id)).toBeNull();

      await pastDue(customerOnly.id, resolved.id);
      await sla.checkOnce(FUTURE());
      expect(
        (await breaches(customerOnly.id))[0].sla_breached_at,
      ).not.toBeNull();
      expect((await breaches(resolved.id))[0].sla_breached_at).toBeNull();
    });

    it('never breaches a ticket that was answered even if its timer is still in Redis (the database decides)', async () => {
      const ticket = await createTicket(s.cust1, `Stale timer ${run}`);
      trackTimer(s.orgId, ticket.id);
      await until(async () => (await timerScore(s.orgId, ticket.id)) !== null);
      await owner.query(
        'UPDATE tickets SET first_response_at = now() WHERE id = $1',
        [ticket.id],
      );
      await sla.checkOnce(FUTURE());
      expect((await breaches(ticket.id))[0].sla_breached_at).toBeNull();
      expect(await timerScore(s.orgId, ticket.id)).toBeNull(); // and the stale timer was cleaned up
    });
  });
});
