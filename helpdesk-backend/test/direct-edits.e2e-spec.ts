import { INestApplication } from '@nestjs/common';
import pg from 'pg';
import {
  auth,
  createTenant,
  createTestApp,
  deleteTenants,
  http,
  ownerPool,
  Tenant,
} from './helpers.js';

// Changing the database by hand (DBeaver, a script) leaves no revoked session behind. The API must notice anyway.
describe('changes made directly in the database', () => {
  let app: INestApplication;
  let owner: pg.Pool;
  let a: Tenant;
  let b: Tenant;
  const slugs: string[] = [];
  const me = (token: string) => http(app).get('/api/v1/auth/me').set(auth(token));
  const settle = () => new Promise((resolve) => setTimeout(resolve, 5600)); // the answer is cached for 5 seconds

  beforeAll(async () => {
    owner = ownerPool();
    app = await createTestApp();
    a = await createTenant(app, 'direct-a');
    b = await createTenant(app, 'direct-b');
    slugs.push(a.slug, b.slug);
  });

  afterAll(async () => {
    await deleteTenants(owner, slugs);
    await owner.end();
    await app.close();
  });

  it('a person switched off, a role changed and a suspended organisation are all cut off within seconds', async () => {
    // Everyone works before the edits (this also fills the short-lived cache, so the expiry path is what is tested).
    for (const token of [a.admin, a.agent, a.cust1, b.admin]) {
      expect((await me(token)).status).toBe(200);
    }

    await owner.query("UPDATE users SET is_active = false WHERE org_id = $1 AND email = 'cust1@x.com'", [a.orgId]);
    await owner.query("UPDATE users SET role = 'CUSTOMER' WHERE org_id = $1 AND email = 'agent@x.com'", [a.orgId]);
    await owner.query('UPDATE organizations SET suspended_at = now() WHERE id = $1', [b.orgId]);
    await settle();

    expect((await me(a.cust1)).status).toBe(401); // switched off
    expect((await me(a.agent)).status).toBe(401); // token still says AGENT, the database says CUSTOMER
    expect((await me(b.admin)).status).toBe(401); // organisation suspended
    expect((await me(a.admin)).status).toBe(200); // untouched people carry on
    // Signing in again picks up the new facts.
    const login = await http(app).post('/api/v1/auth/login').send({ orgSlug: b.slug, email: 'admin@shared.com', password: 'Welcome123' });
    expect(login.status).toBe(403);
  }, 30_000);
});
