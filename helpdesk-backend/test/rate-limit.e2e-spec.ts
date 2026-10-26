import { INestApplication } from '@nestjs/common';
import { Redis } from 'ioredis';
import pg from 'pg';
import {
  auth,
  createTenant,
  createTestApp,
  deleteTenants,
  http,
  ownerPool,
  PASSWORD,
  Tenant,
} from './helpers.js';

const API = '/api/v1';

describe('rate limiting (Redis)', () => {
  let app: INestApplication;
  let owner: pg.Pool;
  let redis: Redis;
  let a: Tenant;
  const slugs: string[] = [];

  const login = (email: string, password = PASSWORD) =>
    http(app)
      .post(`${API}/auth/login`)
      .send({ orgSlug: a.slug, email, password });

  beforeAll(async () => {
    app = await createTestApp();
    owner = ownerPool();
    redis = new Redis({
      host: process.env.REDIS_HOST,
      port: Number(process.env.REDIS_PORT),
      password: process.env.REDIS_PASSWORD,
    });
    a = await createTenant(app, 'rl');
    slugs.push(a.slug);
    // Limits are off for every test file (they log in hundreds of times). Switched on only now, after set-up,
    // so that creating the tenant does not use up the budget being tested.
    process.env.RATE_LIMIT_DISABLED = 'false';
  });

  afterAll(async () => {
    const keys = await redis.keys(`rl:*${a.slug}*`);
    if (keys.length) await redis.del(...keys);
    redis.disconnect();
    await deleteTenants(owner, slugs);
    await owner.end();
    await app.close();
  });

  it('slows down password guessing on one account (10 a minute) with 429 and Retry-After, and leaves other accounts alone', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++)
      statuses.push((await login('cust1@x.com', 'wrong-password')).status);
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(401));
    expect(statuses.slice(10)).toEqual([429, 429]);

    const blocked = await login('cust1@x.com'); // even the right password is refused while blocked
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(Number(blocked.headers['retry-after'])).toBeLessThanOrEqual(60);

    expect((await login('cust2@x.com')).status).toBe(200); // a different account is unaffected
    expect((await login('CUST1@X.COM')).status).toBe(429); // and capitalising the email does not dodge the limit
  });

  it('limits actions per logged-in user, not per address', async () => {
    const results: number[] = [];
    for (let i = 0; i < 32; i++) {
      results.push(
        (await http(app).post(`${API}/auth/socket-token`).set(auth(a.agent)))
          .status,
      );
    }
    expect(results.filter((s) => s === 200)).toHaveLength(30);
    expect(results.filter((s) => s === 429)).toHaveLength(2);
    expect(
      (await http(app).post(`${API}/auth/socket-token`).set(auth(a.admin)))
        .status,
    ).toBe(200); // another user
  });

  it('counts per organisation and email in Redis with a window that expires', async () => {
    const key = `rl:login:${a.slug}:cust1@x.com`;
    expect(Number(await redis.get(key))).toBeGreaterThan(10);
    const ttl = await redis.ttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);
  });

  it('is switched off by RATE_LIMIT_DISABLED', async () => {
    process.env.RATE_LIMIT_DISABLED = 'true';
    try {
      for (let i = 0; i < 15; i++) {
        expect((await login('cust1@x.com', 'wrong-password')).status).toBe(401);
      }
    } finally {
      process.env.RATE_LIMIT_DISABLED = 'false';
    }
  });
});
