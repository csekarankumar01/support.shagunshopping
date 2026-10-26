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

const API = '/api/v1';

describe('assignment, dashboard stats, filters, team, canned responses, notifications log', () => {
  let app: INestApplication;
  let owner: pg.Pool;
  let a: Tenant;
  let b: Tenant;
  let agentId: string;
  let adminId: string;
  let cust1Id: string;
  let t1: string; // A: cust1, HIGH
  let t2: string; // A: cust2
  let t3: string; // A: cust1, subject with LIKE wildcards
  let tB: string;
  const slugs: string[] = [];

  const me = async (token: string) =>
    (await http(app).get(`${API}/auth/me`).set(auth(token))).body
      .userId as string;
  const create = async (token: string, subject: string, priority?: string) =>
    (
      await http(app)
        .post(`${API}/tickets`)
        .set(auth(token))
        .send({ subject, priority })
        .expect(201)
    ).body.id as string;
  const assign = (token: string, ticketId: string, agent: string | null) =>
    http(app)
      .patch(`${API}/tickets/${ticketId}/assign`)
      .set(auth(token))
      .send({ agentId: agent });
  const list = async (token: string, qs: string) =>
    (await http(app).get(`${API}/tickets?${qs}`).set(auth(token))).body as {
      items: { id: string; subject: string }[];
      total: number;
    };

  beforeAll(async () => {
    app = await createTestApp();
    owner = ownerPool();
    a = await createTenant(app, 'fa');
    b = await createTenant(app, 'fb');
    slugs.push(a.slug, b.slug);
    agentId = await me(a.agent);
    adminId = await me(a.admin);
    cust1Id = await me(a.cust1);
    t1 = await create(a.cust1, 'Printer is on fire', 'HIGH');
    t2 = await create(a.cust2, 'Cannot log in');
    t3 = await create(a.cust1, '100% broken_thing');
    tB = await create(b.cust1, 'Other org ticket');
  });

  afterAll(async () => {
    await deleteTenants(owner, slugs);
    await owner.end();
    await app.close();
  });

  describe('assignment', () => {
    it('lets staff assign to an agent or admin of the same organisation, audited, and unassign', async () => {
      const res = await assign(a.agent, t1, agentId);
      expect(res.status).toBe(200);
      expect(res.body.agentId).toBe(agentId);
      expect((await assign(a.agent, t1, adminId)).body.agentId).toBe(adminId);
      expect((await assign(a.agent, t1, adminId)).status).toBe(200); // same again: no extra audit
      const audit = await owner.query(
        `SELECT old_val, new_val, actor_id FROM audit_logs WHERE ticket_id = $1 AND action = 'ASSIGNED' ORDER BY created_at`,
        [t1],
      );
      expect(audit.rows).toEqual([
        { old_val: null, new_val: agentId, actor_id: agentId },
        { old_val: agentId, new_val: adminId, actor_id: agentId },
      ]);
      const cleared = await assign(a.admin, t1, null);
      expect(cleared.body.agentId).toBeNull();
    });

    it('refuses customers, customers as assignees, another organisation, bad ids and extra fields', async () => {
      expect((await assign(a.cust1, t1, agentId)).status).toBe(403);
      expect((await assign(a.agent, t1, cust1Id)).status).toBe(400); // a customer cannot be an assignee
      expect((await assign(b.agent, t1, agentId)).status).toBe(404); // another organisation's ticket
      expect((await assign(b.agent, tB, agentId)).status).toBe(400); // another organisation's agent
      expect(
        (
          await http(app)
            .patch(`${API}/tickets/${t1}/assign`)
            .set(auth(a.agent))
            .send({ agentId: 'nope' })
        ).status,
      ).toBe(400);
      expect(
        (
          await http(app)
            .patch(`${API}/tickets/${t1}/assign`)
            .set(auth(a.agent))
            .send({ agentId, orgId: b.orgId })
        ).status,
      ).toBe(400);
    });
  });

  describe('filters', () => {
    beforeAll(async () => {
      await assign(a.agent, t1, agentId);
      await owner.query(
        'UPDATE tickets SET sla_breached_at = now() WHERE id = $1',
        [t2],
      );
    });

    it('filters by assignee, breached and subject text', async () => {
      expect(
        (await list(a.agent, 'assigned=me')).items.map((t) => t.id),
      ).toEqual([t1]);
      expect((await list(a.admin, 'assigned=me')).total).toBe(0);
      expect((await list(a.admin, 'assigned=unassigned')).total).toBe(2);
      expect(
        (await list(a.agent, 'breached=true')).items.map((t) => t.id),
      ).toEqual([t2]);
      expect((await list(a.agent, 'q=printer')).items.map((t) => t.id)).toEqual(
        [t1],
      );
      expect(
        (await list(a.agent, 'q=PRINTER&status=OPEN&priority=HIGH')).total,
      ).toBe(1);
    });

    it('treats % and _ in the search text as plain characters, not wildcards', async () => {
      expect((await list(a.agent, 'q=100%25')).items.map((t) => t.id)).toEqual([
        t3,
      ]);
      expect(
        (await list(a.agent, 'q=broken_thing')).items.map((t) => t.id),
      ).toEqual([t3]);
      expect((await list(a.agent, 'q=%25')).total).toBe(1); // only the subject that really contains a percent sign
      expect((await list(a.agent, 'q=_')).total).toBe(1);
    });

    it('does not let a customer widen what they can see with these filters', async () => {
      expect(
        (await list(a.cust2, 'assigned=unassigned')).items.map((t) => t.id),
      ).toEqual([t2]);
      expect((await list(a.cust2, 'q=printer')).total).toBe(0);
      expect(
        (await http(app).get(`${API}/tickets?assigned=bob`).set(auth(a.agent)))
          .status,
      ).toBe(400);
    });
  });

  describe('dashboard stats', () => {
    it('counts this organisation only, and only for staff', async () => {
      await http(app)
        .patch(`${API}/tickets/${t3}/status`)
        .set(auth(a.agent))
        .send({ status: 'RESOLVED' });
      const res = await http(app)
        .get(`${API}/tickets/stats`)
        .set(auth(a.agent));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        total: 3,
        open: 2,
        inProgress: 0,
        resolved: 1,
        closed: 0,
        activeHigh: 1,
        activeMedium: 1,
        breached: 1,
        unassigned: 1, // t2 (t1 is assigned, t3 is resolved)
        assignedToMe: 1,
      });
      expect(res.body.avgFirstResponseSeconds).toBeNull();
      const other = await http(app)
        .get(`${API}/tickets/stats`)
        .set(auth(b.agent));
      expect(other.body.total).toBe(1);
      expect(
        (await http(app).get(`${API}/tickets/stats`).set(auth(a.cust1))).status,
      ).toBe(403);
      expect((await http(app).get(`${API}/tickets/stats`)).status).toBe(401);
    });

    it('reports the average time to first public reply', async () => {
      await owner.query(
        `UPDATE tickets SET first_response_at = created_at + interval '90 seconds' WHERE id = $1`,
        [t1],
      );
      const res = await http(app)
        .get(`${API}/tickets/stats`)
        .set(auth(a.admin));
      expect(res.body.avgFirstResponseSeconds).toBeCloseTo(90, 0);
    });
  });

  describe('team', () => {
    it('shows an admin everyone, an agent only staff, and nobody else anything', async () => {
      const asAdmin = (await http(app).get(`${API}/team`).set(auth(a.admin)))
        .body as { email: string; role: string; passwordHash?: string }[];
      expect(asAdmin.map((m) => m.email)).toEqual([
        'admin@shared.com',
        'agent@x.com',
        'cust1@x.com',
        'cust2@x.com',
      ]);
      expect(JSON.stringify(asAdmin)).not.toMatch(/password/i);
      const asAgent = (await http(app).get(`${API}/team`).set(auth(a.agent)))
        .body as { email: string }[];
      expect(asAgent.map((m) => m.email)).toEqual([
        'admin@shared.com',
        'agent@x.com',
      ]);
      expect(
        (await http(app).get(`${API}/team`).set(auth(a.cust1))).status,
      ).toBe(403);
    });
  });

  describe('canned responses', () => {
    let cannedId: string;
    const canned = (token: string) =>
      http(app).post(`${API}/canned-responses`).set(auth(token));

    it("lets staff create, list, edit and delete their own organisation's responses", async () => {
      const created = await canned(a.agent).send({
        title: '  Greeting ',
        body: ' Hello, thanks for writing in. ',
      });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({
        title: 'Greeting',
        body: 'Hello, thanks for writing in.',
      });
      cannedId = created.body.id;
      expect(
        (
          await canned(a.admin).send({
            title: 'Closing',
            body: 'Anything else?',
          })
        ).status,
      ).toBe(201);

      const titles = (
        await http(app).get(`${API}/canned-responses`).set(auth(a.agent))
      ).body.map((c: { title: string }) => c.title);
      expect(titles).toEqual(['Closing', 'Greeting']);

      const edited = await http(app)
        .patch(`${API}/canned-responses/${cannedId}`)
        .set(auth(a.admin))
        .send({ body: 'Hi there!' });
      expect(edited.body).toMatchObject({
        title: 'Greeting',
        body: 'Hi there!',
      });
    });

    it('rejects duplicates, blanks and customers, and hides them from other organisations', async () => {
      expect(
        (await canned(a.agent).send({ title: 'Greeting', body: 'again' }))
          .status,
      ).toBe(409);
      expect(
        (await canned(a.agent).send({ title: '   ', body: 'x' })).status,
      ).toBe(400);
      expect(
        (await canned(a.agent).send({ title: 'x', body: 'y', orgId: b.orgId }))
          .status,
      ).toBe(400);
      expect(
        (await canned(a.cust1).send({ title: 'x', body: 'y' })).status,
      ).toBe(403);
      expect(
        (await http(app).get(`${API}/canned-responses`).set(auth(a.cust1)))
          .status,
      ).toBe(403);

      expect(
        (await http(app).get(`${API}/canned-responses`).set(auth(b.agent)))
          .body,
      ).toEqual([]);
      expect(
        (
          await http(app)
            .patch(`${API}/canned-responses/${cannedId}`)
            .set(auth(b.agent))
            .send({ title: 'hijack' })
        ).status,
      ).toBe(404);
      expect(
        (
          await http(app)
            .delete(`${API}/canned-responses/${cannedId}`)
            .set(auth(b.admin))
        ).status,
      ).toBe(404);
      expect(
        (
          await canned(b.agent).send({
            title: 'Greeting',
            body: 'same title, other org',
          })
        ).status,
      ).toBe(201); // titles are unique per organisation
    });

    it('deletes', async () => {
      expect(
        (
          await http(app)
            .delete(`${API}/canned-responses/${cannedId}`)
            .set(auth(a.agent))
        ).status,
      ).toBe(204);
      expect(
        (
          await http(app)
            .delete(`${API}/canned-responses/${cannedId}`)
            .set(auth(a.agent))
        ).status,
      ).toBe(404);
    });
  });

  describe('notifications log', () => {
    it('is for admins only and shows only their own organisation', async () => {
      const ticket = (
        await owner.query<{ requester_id: string }>(
          'SELECT requester_id FROM tickets WHERE id = $1',
          [t1],
        )
      ).rows[0];
      await owner.query(
        `INSERT INTO notifications (org_id, ticket_id, kind, recipient_id, recipient_email, subject, body, status)
         VALUES ($1, $2, 'TICKET_RECEIPT', $3, 'cust1@x.com', 's', 'b', 'SENT')`,
        [a.orgId, t1, ticket.requester_id],
      );
      const res = await http(app)
        .get(`${API}/notifications`)
        .set(auth(a.admin));
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({
        kind: 'TICKET_RECEIPT',
        status: 'SENT',
        recipientEmail: 'cust1@x.com',
      });
      expect(
        (await http(app).get(`${API}/notifications`).set(auth(b.admin))).body,
      ).toEqual([]);
      expect(
        (await http(app).get(`${API}/notifications`).set(auth(a.agent))).status,
      ).toBe(403);
    });
  });
});
