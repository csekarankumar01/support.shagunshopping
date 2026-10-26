import { INestApplication } from '@nestjs/common';
import { Redis } from 'ioredis';
import pg from 'pg';
import { io, Socket } from 'socket.io-client';
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

describe('agent presence (Redis)', () => {
  let app: INestApplication;
  let owner: pg.Pool;
  let redis: Redis;
  let baseUrl: string;
  let a: Tenant;
  let b: Tenant;
  const slugs: string[] = [];
  const open: Socket[] = [];

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
  const online = async (token: string) =>
    (await http(app).get(`${API}/presence`).set(auth(token))).body as {
      email: string;
    }[];
  const until = async (check: () => Promise<boolean> | boolean, ms = 4000) => {
    const end = Date.now() + ms;
    while (!(await check()) && Date.now() < end)
      await new Promise((r) => setTimeout(r, 40));
    expect(await check()).toBe(true);
  };
  const settle = () => new Promise((r) => setTimeout(r, 400));
  const emails = async (token: string) =>
    (await online(token)).map((u) => u.email).sort();

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
    a = await createTenant(app, 'pra');
    b = await createTenant(app, 'prb');
    slugs.push(a.slug, b.slug);
  });

  afterEach(async () => {
    for (const socket of open.splice(0)) socket.close();
    await until(async () => (await emails(a.admin)).length === 0);
  });

  afterAll(async () => {
    await redis.del(`presence:${a.orgId}`, `presence:${b.orgId}`);
    redis.disconnect();
    await deleteTenants(owner, slugs);
    await owner.end();
    await app.close();
  });

  it('lists staff who are connected, to staff of the same organisation only', async () => {
    await connectAs(a.agent);
    await connectAs(a.admin);
    await connectAs(b.agent);
    await until(async () => (await emails(a.admin)).length === 2);
    expect(await emails(a.agent)).toEqual(['admin@shared.com', 'agent@x.com']);
    expect(await emails(b.agent)).toEqual(['agent@x.com']); // org B sees only its own agent
    expect(
      (await http(app).get(`${API}/presence`).set(auth(a.cust1))).status,
    ).toBe(403);
    expect((await http(app).get(`${API}/presence`)).status).toBe(401);
    await redis.del(`presence:${b.orgId}`);
  });

  it('never lists customers, even when they are connected', async () => {
    await connectAs(a.cust1);
    await settle();
    expect(await online(a.admin)).toEqual([]);
  });

  it('keeps a user online until their last tab closes', async () => {
    const tabOne = await connectAs(a.agent);
    const tabTwo = await connectAs(a.agent);
    await until(async () => (await emails(a.admin)).length === 1);
    tabOne.close();
    await settle();
    expect(await emails(a.admin)).toEqual(['agent@x.com']);
    tabTwo.close();
    await until(async () => (await emails(a.admin)).length === 0);
  });

  it('tells the other staff when someone comes online or goes offline, and tells customers nothing', async () => {
    const admin = await connectAs(a.admin);
    const customer = await connectAs(a.cust1);
    const seenByAdmin: { online: boolean }[] = [];
    const seenByCustomer: unknown[] = [];
    admin.on('presence:changed', (e) => seenByAdmin.push(e));
    customer.on('presence:changed', (e) => seenByCustomer.push(e));
    const agent = await connectAs(a.agent);
    await until(() => seenByAdmin.length === 1);
    expect(seenByAdmin[0]).toMatchObject({ online: true });
    agent.close();
    await until(() => seenByAdmin.length === 2);
    expect(seenByAdmin[1]).toMatchObject({ online: false });
    await settle();
    expect(seenByCustomer).toHaveLength(0);
  });

  it('ignores an entry whose heartbeat stopped long ago (a crashed server leaves no ghosts)', async () => {
    const me = await http(app).get(`${API}/auth/me`).set(auth(a.agent));
    await redis.zadd(
      `presence:${a.orgId}`,
      Date.now() - 5 * 60_000,
      me.body.userId,
    );
    expect(await online(a.admin)).toEqual([]);
    expect(await redis.zcard(`presence:${a.orgId}`)).toBe(0); // and it was swept
  });
});
