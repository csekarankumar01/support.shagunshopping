import { randomBytes } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import pg from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

export const PASSWORD = 'Welcome123';

export async function createTestApp() {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  return app;
}

export const http = (app: INestApplication) => request(app.getHttpServer());

const connectionBase = () => ({
  host: process.env.POSTGRES_HOST,
  port: Number(process.env.POSTGRES_PORT),
  database: process.env.POSTGRES_DB,
});

/** The database owner (a superuser): bypasses Row-Level Security. Only for test setup, cleanup and inspection. */
export const ownerPool = () =>
  new pg.Pool({
    ...connectionBase(),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
  });

/** A fresh connection as the restricted application role, exactly what the running app uses. */
export const appRoleClient = () =>
  new pg.Client({
    ...connectionBase(),
    user: process.env.APP_DB_USER,
    password: process.env.APP_DB_PASSWORD,
  });

export interface Tenant {
  slug: string;
  orgId: string;
  admin: string;
  agent: string;
  cust1: string;
  cust2: string;
}

export const uniqueSlug = (label: string) =>
  `e2e-${label}-${randomBytes(4).toString('hex')}`;

export async function login(
  app: INestApplication,
  orgSlug: string,
  email: string,
) {
  const res = await http(app)
    .post('/api/v1/auth/login')
    .send({ orgSlug, email, password: PASSWORD });
  if (res.status !== 200)
    throw new Error(`login ${orgSlug}/${email} failed: ${res.status}`);
  return res.body.accessToken as string;
}

/** Registers an organisation and invites one agent and two customers. Returns a token for each. */
export async function createTenant(
  app: INestApplication,
  label: string,
): Promise<Tenant> {
  const slug = uniqueSlug(label);
  const reg = await http(app)
    .post('/api/v1/auth/register-org')
    .send({
      orgName: `Org ${label}`,
      orgSlug: slug,
      email: 'admin@shared.com',
      password: PASSWORD,
    });
  if (reg.status !== 201)
    throw new Error(
      `register-org failed: ${reg.status} ${JSON.stringify(reg.body)}`,
    );

  const admin = await login(app, slug, 'admin@shared.com');
  for (const [email, role] of [
    ['agent@x.com', 'AGENT'],
    ['cust1@x.com', 'CUSTOMER'],
    ['cust2@x.com', 'CUSTOMER'],
  ]) {
    const res = await http(app)
      .post('/api/v1/auth/invite')
      .set('Authorization', `Bearer ${admin}`)
      .send({ email, password: PASSWORD, role });
    if (res.status !== 201)
      throw new Error(`invite ${email} failed: ${res.status}`);
  }
  return {
    slug,
    orgId: reg.body.organization.id,
    admin,
    agent: await login(app, slug, 'agent@x.com'),
    cust1: await login(app, slug, 'cust1@x.com'),
    cust2: await login(app, slug, 'cust2@x.com'),
  };
}

/** Removes everything the tests created. Runs as the owner; session_replication_role=replica skips triggers (audit_logs is append-only). */
export async function deleteTenants(owner: pg.Pool, slugs: string[]) {
  const client = await owner.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL session_replication_role = replica');
    const orgs = '(SELECT id FROM organizations WHERE slug = ANY($1))';
    for (const table of ['audit_logs', 'comments', 'tickets', 'users']) {
      await client.query(`DELETE FROM ${table} WHERE org_id IN ${orgs}`, [
        slugs,
      ]);
    }
    await client.query('DELETE FROM organizations WHERE slug = ANY($1)', [
      slugs,
    ]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
