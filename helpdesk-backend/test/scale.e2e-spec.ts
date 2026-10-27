import { INestApplication } from '@nestjs/common';
import { Redis } from 'ioredis';
import pg from 'pg';
import request from 'supertest';
import { io, Socket } from 'socket.io-client';
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

// A second listening copy of the whole API in the same test process: two "instances" sharing Postgres and Redis.
describe('several API instances, SLA timer recovery, metrics and security headers', () => {
  let one: INestApplication;
  let two: INestApplication;
  let owner: pg.Pool;
  let redis: Redis;
  let t: Tenant;
  let ticket: string;
  const slugs: string[] = [];
  const open: Socket[] = [];
  const urlOf = (app: INestApplication) =>
    `http://localhost:${(app.getHttpServer().address() as { port: number }).port}`;
  const via = (app: INestApplication) => request(app.getHttpServer());

  const connect = async (app: INestApplication, accessToken: string) => {
    const res = await via(app)
      .post(`${API}/auth/socket-token`)
      .set(auth(accessToken))
      .expect(200);
    return new Promise<Socket>((resolve, reject) => {
      const socket = io(`${urlOf(app)}/support`, {
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
  const join = (s: Socket, ticketId: string) =>
    s.emitWithAck('ticket:join', { ticketId });
  const listen = <E = Record<string, unknown>>(s: Socket, event: string) => {
    const seen: E[] = [];
    s.on(event, (e: E) => seen.push(e));
    return seen;
  };
  const until = async (check: () => Promise<boolean> | boolean, ms = 8000) => {
    const end = Date.now() + ms;
    while (!(await check()) && Date.now() < end)
      await new Promise((r) => setTimeout(r, 60));
    expect(await check()).toBe(true);
  };
  const settle = (ms = 500) => new Promise((r) => setTimeout(r, ms));
  const onlineEmails = async (app: INestApplication, token: string) =>
    (
      (await via(app).get(`${API}/presence`).set(auth(token))).body as {
        email: string;
      }[]
    )
      .map((u) => u.email)
      .sort();

  beforeAll(async () => {
    one = await createTestApp();
    await one.listen(0);
    two = await createTestApp();
    await two.listen(0);
    owner = ownerPool();
    redis = new Redis({
      host: process.env.REDIS_HOST,
      port: Number(process.env.REDIS_PORT),
      password: process.env.REDIS_PASSWORD,
      keyPrefix: process.env.REDIS_KEY_PREFIX,
    });
    t = await createTenant(one, 'sc');
    slugs.push(t.slug);
    ticket = (
      await http(one)
        .post(`${API}/tickets`)
        .set(auth(t.cust1))
        .send({ subject: 'Across instances' })
        .expect(201)
    ).body.id;
  }, 60_000);

  afterEach(() => {
    for (const socket of open.splice(0)) socket.close();
  });

  afterAll(async () => {
    await redis.zrem(
      SLA_KEY,
      ...(await redis.zrange(SLA_KEY, '0', '-1')).filter((m) =>
        m.startsWith(t.orgId),
      ),
    );
    await redis.del(`presence:${t.orgId}`);
    redis.disconnect();
    await deleteTenants(owner, slugs);
    await owner.end();
    await one.close().catch(() => undefined);
    await two.close().catch(() => undefined);
  });

  describe('chat across two instances', () => {
    it('delivers messages and status changes between users connected to different instances, and still hides internal notes', async () => {
      const agent = await connect(one, t.agent); // instance 1
      const customer = await connect(two, t.cust1); // instance 2
      await join(agent, ticket);
      await join(customer, ticket);
      const toAgent = listen<{ message: string }>(agent, 'comment:new');
      const toCustomer = listen<{
        message: string;
        authorEmail: string | null;
      }>(customer, 'comment:new');
      const statusToCustomer = listen<{ status: string }>(
        customer,
        'ticket:status',
      );

      await via(one)
        .post(`${API}/tickets/${ticket}/comments`)
        .set(auth(t.agent))
        .send({ message: 'from instance 1' })
        .expect(201);
      await until(() => toCustomer.length === 1);
      expect(toCustomer[0]).toMatchObject({
        message: 'from instance 1',
        authorEmail: null,
      }); // redaction still applies

      await via(two)
        .post(`${API}/tickets/${ticket}/comments`)
        .set(auth(t.cust1))
        .send({ message: 'from instance 2' })
        .expect(201);
      await until(() => toAgent.some((m) => m.message === 'from instance 2'));

      await via(one)
        .post(`${API}/tickets/${ticket}/comments`)
        .set(auth(t.agent))
        .send({ message: 'SECRET across instances', isInternalNote: true })
        .expect(201);
      await via(two)
        .patch(`${API}/tickets/${ticket}/status`)
        .set(auth(t.agent))
        .send({ status: 'IN_PROGRESS' })
        .expect(200);
      await until(() => statusToCustomer.length === 1);
      await settle();
      expect(toCustomer.map((m) => m.message)).not.toContain(
        'SECRET across instances',
      );
    });

    it('keeps a user online while they have a live socket on either instance, and announces offline only when the last closes', async () => {
      const admin = await connect(two, t.admin);
      const agentId = (
        await via(two).get(`${API}/team`).set(auth(t.admin))
      ).body.find((m: { email: string }) => m.email === 'agent@x.com')
        .userId as string;
      const announcements = listen<{ userId: string; online: boolean }>(
        admin,
        'presence:changed',
      );
      const agentEvents = () =>
        announcements.filter((a) => a.userId === agentId); // the admin's own arrival is announced too
      const onOne = await connect(one, t.agent);
      const onTwo = await connect(two, t.agent);
      await until(async () =>
        (await onlineEmails(two, t.admin)).includes('agent@x.com'),
      );
      expect(await onlineEmails(one, t.admin)).toEqual([
        'admin@shared.com',
        'agent@x.com',
      ]); // same answer from either instance
      expect(agentEvents().filter((a) => a.online).length).toBeGreaterThanOrEqual(1); // announced when they arrive (once per socket)

      onOne.close();
      await settle(800);
      expect(await onlineEmails(two, t.admin)).toContain('agent@x.com');
      expect(agentEvents().filter((a) => !a.online)).toHaveLength(0);

      onTwo.close();
      await until(
        async () => !(await onlineEmails(two, t.admin)).includes('agent@x.com'),
      );
      await until(() => agentEvents().filter((a) => !a.online).length === 1);
    });

    it('closes a socket on one instance when its session is revoked through the other', async () => {
      const session = (
        await via(one)
          .post(`${API}/auth/login`)
          .send({
            orgSlug: t.slug,
            email: 'cust2@x.com',
            password: 'Welcome123',
          })
          .expect(200)
      ).body as { accessToken: string; refreshToken: string };
      const socket = await connect(one, session.accessToken);
      let expired = 0;
      socket.on('session:expired', () => expired++);
      await via(two)
        .post(`${API}/auth/logout`)
        .send({ refreshToken: session.refreshToken })
        .expect(200);
      await until(() => !socket.connected);
      expect(expired).toBe(1);
    });

    it("removes an instance's presence entries when it shuts down cleanly", async () => {
      const third = await createTestApp();
      await third.listen(0);
      const socket = await connect(third, t.agent);
      await until(async () =>
        (await onlineEmails(two, t.admin)).includes('agent@x.com'),
      );
      socket.close();
      const again = await connect(third, t.agent);
      await until(async () =>
        (await onlineEmails(two, t.admin)).includes('agent@x.com'),
      );
      await third.close(); // the socket is still open when the instance stops
      await until(
        async () => !(await onlineEmails(two, t.admin)).includes('agent@x.com'),
      );
      again.close();
    });
  });

  describe('SLA timer recovery', () => {
    const score = async (ticketId: string) =>
      redis.zscore(SLA_KEY, `${t.orgId}:${ticketId}`);

    it('restores missing timers from the tickets, never touches existing ones, and skips tickets that no longer need one', async () => {
      const sla = two.get(SlaService);
      const make = async (subject: string) =>
        (
          await via(one)
            .post(`${API}/tickets`)
            .set(auth(t.cust2))
            .send({ subject })
            .expect(201)
        ).body as { id: string; slaDeadline: string };
      const open1 = await make('Pending');
      const answered = await make('Answered');
      const resolved = await make('Resolved');
      await via(one)
        .post(`${API}/tickets/${answered.id}/comments`)
        .set(auth(t.agent))
        .send({ message: 'hello' })
        .expect(201);
      await via(one)
        .patch(`${API}/tickets/${resolved.id}/status`)
        .set(auth(t.agent))
        .send({ status: 'RESOLVED' })
        .expect(200);
      await redis.zrem(
        SLA_KEY,
        ...[open1, answered, resolved, { id: ticket }].map(
          (x) => `${t.orgId}:${x.id}`,
        ),
      ); // "Redis lost its data"
      expect(await score(open1.id)).toBeNull();

      const restored = await sla.reconcile();
      expect(restored).toBeGreaterThanOrEqual(1); // this organisation's one running ticket (others in the test database may add more)
      expect(Number(await score(open1.id))).toBe(Date.parse(open1.slaDeadline)); // with its real deadline
      expect(await score(answered.id)).toBeNull(); // already answered
      expect(await score(resolved.id)).toBeNull(); // already resolved

      await redis.zadd(SLA_KEY, 12345, `${t.orgId}:${open1.id}`);
      await sla.reconcile();
      expect(Number(await score(open1.id))).toBe(12345); // NX: an existing timer is never overwritten
      expect(await sla.reconcile()).toBe(0); // and a second pass has nothing to do
    });
  });

  describe('private deployments', () => {
    it('refuses new organisations when ALLOW_REGISTRATION=false, while everything else keeps working', async () => {
      process.env.ALLOW_REGISTRATION = 'false';
      const closed = await createTestApp();
      try {
        const res = await via(closed)
          .post(`${API}/auth/register-org`)
          .send({
            orgName: 'Nope',
            orgSlug: `closed-${Date.now().toString(36)}`,
            email: 'a@b.test',
            password: 'Welcome123',
          });
        expect(res.status).toBe(403);
        expect(res.body.message).toBe('Registration is closed on this server');
        const login = await via(closed)
          .post(`${API}/auth/login`)
          .send({ orgSlug: t.slug, email: 'cust1@x.com', password: 'Welcome123' });
        expect(login.status).toBe(200);
      } finally {
        delete process.env.ALLOW_REGISTRATION;
        await closed.close();
      }
    });
  });

  describe('metrics and headers', () => {
    it('hides the metrics endpoint unless a token is configured, and then requires it', async () => {
      expect((await via(one).get(`${API}/metrics`)).status).toBe(404); // not configured: looks like no such route
      process.env.METRICS_TOKEN = 'metrics-test-token';
      try {
        expect((await via(one).get(`${API}/metrics`)).status).toBe(401);
        expect(
          (
            await via(one)
              .get(`${API}/metrics`)
              .set({ Authorization: 'Bearer wrong-token-value' })
          ).status,
        ).toBe(401);
        const res = await via(one)
          .get(`${API}/metrics`)
          .set({ Authorization: 'Bearer metrics-test-token' });
        expect(res.status).toBe(200);
        expect(res.text).toContain('helpdesk_http_requests_total');
        expect(res.text).toContain('helpdesk_outbox_pending');
        expect(res.text).toContain('helpdesk_websocket_connections');
        expect(res.text).toMatch(
          /helpdesk_http_request_duration_seconds_bucket\{[^}]*route="\/api\/v1\/tickets"/,
        );
        // counted by route pattern and without any tenant data
        expect(res.text).not.toContain(t.orgId);
        expect(res.text).not.toContain('cust1@x.com');
      } finally {
        delete process.env.METRICS_TOKEN;
      }
    });

    it('sends security headers on every response', async () => {
      const res = await via(one).get(`${API}/health`);
      expect(res.status).toBe(200);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBeDefined();
      expect(res.headers['strict-transport-security']).toBeDefined();
      expect(res.headers['x-powered-by']).toBeUndefined(); // does not advertise the framework
      expect(res.headers['content-security-policy']).toBeDefined();
    });

    it('reports health without needing a login', async () => {
      const res = await via(two).get(`${API}/health`);
      expect(res.body).toEqual({ status: 'ok', database: 'up', redis: 'up' });
    });
  });
});
