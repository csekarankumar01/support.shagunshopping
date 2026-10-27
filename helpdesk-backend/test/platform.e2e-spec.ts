import { randomBytes } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import pg from 'pg';
import {
  appRoleClient,
  auth,
  createTenant,
  createTestApp,
  deleteTenants,
  http,
  ownerPool,
  PASSWORD,
  Tenant,
} from './helpers.js';

const P = '/api/v1/platform';

describe('platform (super) admin', () => {
  let app: INestApplication;
  let owner: pg.Pool;
  let a: Tenant;
  let b: Tenant;
  let platform: string; // the super admin's token
  let adminId: string;
  const email = `root-${randomBytes(4).toString('hex')}@platform.test`;
  const slugs: string[] = [];
  let ticketA: string;

  const userId = async (orgId: string, userEmail: string) =>
    (
      await owner.query<{ id: string }>(
        'SELECT id FROM users WHERE org_id = $1 AND email = $2',
        [orgId, userEmail],
      )
    ).rows[0].id;
  const actions = async (orgId: string) =>
    (
      await owner.query<{ action: string }>(
        'SELECT action FROM platform_audit_logs WHERE org_id = $1 ORDER BY id',
        [orgId],
      )
    ).rows.map((r) => r.action);

  beforeAll(async () => {
    owner = ownerPool();
    app = await createTestApp();
    const hash = await bcrypt.hash(PASSWORD, 4);
    adminId = (
      await owner.query<{ id: string }>(
        'INSERT INTO platform_admins (email, password_hash) VALUES ($1, $2) RETURNING id',
        [email, hash],
      )
    ).rows[0].id;
    a = await createTenant(app, 'plat-a');
    b = await createTenant(app, 'plat-b');
    slugs.push(a.slug, b.slug);
    ticketA = (
      await http(app)
        .post('/api/v1/tickets')
        .set(auth(a.cust1))
        .send({ subject: 'Printer on fire', priority: 'HIGH' })
        .expect(201)
    ).body.id;
    await http(app)
      .post(`/api/v1/tickets/${ticketA}/comments`)
      .set(auth(a.agent))
      .send({ message: 'Staff only: do not tell the customer', isInternalNote: true })
      .expect(201);
    const res = await http(app).post(`${P}/login`).send({ email, password: PASSWORD });
    expect(res.status).toBe(200);
    platform = res.body.accessToken;
  });

  afterAll(async () => {
    await owner.query('DELETE FROM platform_audit_logs WHERE admin_id = $1', [adminId]);
    await owner.query('DELETE FROM platform_admins WHERE id = $1', [adminId]);
    await deleteTenants(owner, slugs);
    await owner.end();
    await app.close();
  });

  describe('signing in and the wall between the two kinds of token', () => {
    it('refuses a wrong password and an unknown account with the same answer', async () => {
      const wrong = await http(app).post(`${P}/login`).send({ email, password: 'nope-nope-nope' });
      const unknown = await http(app)
        .post(`${P}/login`)
        .send({ email: 'ghost@platform.test', password: PASSWORD });
      expect(wrong.status).toBe(401);
      expect(unknown.status).toBe(401);
      expect(unknown.body.message).toBe(wrong.body.message);
    });

    it('a tenant token (even a tenant admin) cannot use the platform API', async () => {
      for (const token of [a.admin, a.agent, a.cust1]) {
        expect((await http(app).get(`${P}/overview`).set(auth(token))).status).toBe(401);
      }
      expect((await http(app).get(`${P}/overview`)).status).toBe(401);
    });

    it('a platform token cannot call the tenant API', async () => {
      expect((await http(app).get('/api/v1/auth/me').set(auth(platform))).status).toBe(401);
      expect((await http(app).get('/api/v1/tickets').set(auth(platform))).status).toBe(401);
    });

    it('stops working at once when the platform admin is deactivated', async () => {
      await owner.query('UPDATE platform_admins SET is_active = false WHERE id = $1', [adminId]);
      expect((await http(app).get(`${P}/overview`).set(auth(platform))).status).toBe(401);
      expect((await http(app).post(`${P}/login`).send({ email, password: PASSWORD })).status).toBe(401);
      await owner.query('UPDATE platform_admins SET is_active = true WHERE id = $1', [adminId]);
      expect((await http(app).get(`${P}/overview`).set(auth(platform))).status).toBe(200);
    });
  });

  describe('seeing everything', () => {
    it('lists every organisation, with counts', async () => {
      const res = await http(app).get(`${P}/organizations`).set(auth(platform));
      expect(res.status).toBe(200);
      const slugsSeen = res.body.map((o: { slug: string }) => o.slug);
      expect(slugsSeen).toEqual(expect.arrayContaining([a.slug, b.slug]));
      const orgA = res.body.find((o: { slug: string }) => o.slug === a.slug);
      expect(orgA).toMatchObject({ status: 'ACTIVE', agents: 1, customers: 2, tickets: 1 });
    });

    it('searches organisations by name or slug, treating wildcards literally', async () => {
      const found = await http(app).get(`${P}/organizations?q=${a.slug}`).set(auth(platform));
      expect(found.body.map((o: { slug: string }) => o.slug)).toEqual([a.slug]);
      const wildcard = await http(app).get(`${P}/organizations?q=%25`).set(auth(platform));
      expect(wildcard.body).toEqual([]);
    });

    it('shows an organisation, its users (no password hashes) and its tickets', async () => {
      const org = (await http(app).get(`${P}/organizations`).set(auth(platform))).body.find(
        (o: { slug: string }) => o.slug === a.slug,
      );
      const users = await http(app).get(`${P}/organizations/${org.id}/users`).set(auth(platform));
      expect(users.body).toHaveLength(4);
      expect(JSON.stringify(users.body)).not.toMatch(/password|\$2[aby]\$/);
      const tickets = await http(app).get(`${P}/organizations/${org.id}/tickets`).set(auth(platform));
      expect(tickets.body.total).toBe(1);
      expect(tickets.body.items[0]).toMatchObject({ subject: 'Printer on fire', requester: 'cust1@x.com' });
    });

    it('shows ticket contents including internal notes, and records that it looked', async () => {
      const res = await http(app).get(`${P}/tickets/${ticketA}`).set(auth(platform));
      expect(res.status).toBe(200);
      expect(res.body.comments.some((c: { isInternalNote: boolean }) => c.isInternalNote)).toBe(true);
      expect(await actions(a.orgId)).toContain('TICKET_VIEWED');
    });

    it('answers 404 for an unknown id and 400 for a malformed one', async () => {
      expect((await http(app).get(`${P}/tickets/00000000-0000-4000-8000-000000000000`).set(auth(platform))).status).toBe(404);
      expect((await http(app).get(`${P}/tickets/not-a-uuid`).set(auth(platform))).status).toBe(400);
    });

    it('has an overview', async () => {
      const res = await http(app).get(`${P}/overview`).set(auth(platform));
      expect(res.body.organizations).toBeGreaterThanOrEqual(2);
      expect(res.body.tickets).toBeGreaterThanOrEqual(1);
    });
  });

  describe('changing things (all audited)', () => {
    it('edits name, plan and SLA, and rejects bad values', async () => {
      const res = await http(app)
        .patch(`${P}/organizations/${a.orgId}`)
        .set(auth(platform))
        .send({ name: 'Renamed Org', plan: 'PRO', slaMins: 90 });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ name: 'Renamed Org', plan: 'PRO', slaMins: 90 });
      expect((await http(app).patch(`${P}/organizations/${a.orgId}`).set(auth(platform)).send({ plan: 'GOLD' })).status).toBe(400);
      expect((await http(app).patch(`${P}/organizations/${a.orgId}`).set(auth(platform)).send({ slaMins: 0 })).status).toBe(400);
      expect(await actions(a.orgId)).toContain('ORG_UPDATED');
    });

    it('deactivating a user cuts their session at once; the last active admin cannot be removed', async () => {
      const agentId = await userId(a.orgId, 'agent@x.com');
      expect((await http(app).get('/api/v1/auth/me').set(auth(a.agent))).status).toBe(200);
      const off = await http(app).patch(`${P}/users/${agentId}`).set(auth(platform)).send({ isActive: false });
      expect(off.status).toBe(200);
      expect((await http(app).get('/api/v1/auth/me').set(auth(a.agent))).status).toBe(401);
      const retry = await http(app).post('/api/v1/auth/login').send({ orgSlug: a.slug, email: 'agent@x.com', password: PASSWORD });
      expect(retry.status).toBe(401);

      const adminUser = await userId(a.orgId, 'admin@shared.com');
      const demote = await http(app).patch(`${P}/users/${adminUser}`).set(auth(platform)).send({ role: 'AGENT' });
      expect(demote.status).toBe(400);
      expect(demote.body.message).toMatch(/without an active admin/);
      expect(await actions(a.orgId)).toContain('USER_UPDATED');
    });

    it('suspending an organisation ends its sessions and blocks sign-in; the other tenant is untouched; activating restores it', async () => {
      expect((await http(app).get('/api/v1/auth/me').set(auth(b.admin))).status).toBe(200);
      const suspended = await http(app)
        .post(`${P}/organizations/${b.orgId}/suspend`)
        .set(auth(platform))
        .send({ reason: 'Unpaid invoice' });
      expect(suspended.status).toBe(200);
      expect(suspended.body).toMatchObject({ status: 'SUSPENDED', suspendedReason: 'Unpaid invoice' });

      expect((await http(app).get('/api/v1/auth/me').set(auth(b.admin))).status).toBe(401);
      expect((await http(app).get('/api/v1/auth/me').set(auth(b.cust1))).status).toBe(401);
      const blocked = await http(app).post('/api/v1/auth/login').send({ orgSlug: b.slug, email: 'admin@shared.com', password: PASSWORD });
      expect(blocked.status).toBe(403);
      expect(blocked.body.message).toMatch(/suspended/);
      // A wrong password still looks like any other failed login: suspension is not revealed to strangers.
      const stranger = await http(app).post('/api/v1/auth/login').send({ orgSlug: b.slug, email: 'admin@shared.com', password: 'wrong-password' });
      expect(stranger.status).toBe(401);
      // The other organisation carries on.
      expect((await http(app).get('/api/v1/auth/me').set(auth(a.admin))).status).toBe(200);
      expect((await http(app).post(`${P}/organizations/${b.orgId}/suspend`).set(auth(platform)).send({ reason: 'again' })).status).toBe(400);

      const back = await http(app).post(`${P}/organizations/${b.orgId}/activate`).set(auth(platform));
      expect(back.body.status).toBe('ACTIVE');
      expect((await http(app).post('/api/v1/auth/login').send({ orgSlug: b.slug, email: 'admin@shared.com', password: PASSWORD })).status).toBe(200);
      expect(await actions(b.orgId)).toEqual(expect.arrayContaining(['ORG_SUSPENDED', 'ORG_ACTIVATED']));
    });

    it('records who did what in the platform audit log', async () => {
      const res = await http(app).get(`${P}/audit?orgId=${a.orgId}`).set(auth(platform));
      expect(res.status).toBe(200);
      expect(res.body[0]).toMatchObject({ adminEmail: email });
      expect(res.body.map((r: { action: string }) => r.action)).toEqual(
        expect.arrayContaining(['ORG_UPDATED', 'USER_UPDATED', 'TICKET_VIEWED']),
      );
    });
  });

  describe('the database still protects tenants from each other', () => {
    it('the application role, in a tenant context, cannot read platform tables or other tenants', async () => {
      const client = appRoleClient();
      await client.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.current_org_id', $1, true)", [a.orgId]);
        expect((await client.query('SELECT count(*)::int AS n FROM platform_audit_logs')).rows[0].n).toBe(0);
        expect((await client.query('SELECT count(*)::int AS n FROM organizations')).rows[0].n).toBe(1);
        await client.query('ROLLBACK');
        await expect(client.query('SELECT * FROM platform_admins')).rejects.toThrow(/permission denied/);
      } finally {
        await client.end();
      }
    });

    it('without the platform switch nothing is visible; the audit log cannot be altered', async () => {
      const client = appRoleClient();
      await client.connect();
      try {
        expect((await client.query('SELECT count(*)::int AS n FROM tickets')).rows[0].n).toBe(0);
        await expect(client.query('DELETE FROM platform_audit_logs')).rejects.toThrow(/permission denied/);
        await expect(client.query('UPDATE platform_audit_logs SET action = $1', ['x'])).rejects.toThrow(/permission denied/);
      } finally {
        await client.end();
      }
    });
  });
});
