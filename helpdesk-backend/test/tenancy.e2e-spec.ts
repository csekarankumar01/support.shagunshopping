import { INestApplication } from '@nestjs/common';
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
  uniqueSlug,
} from './helpers.js';

const API = '/api/v1';

describe('multi-tenancy through the API', () => {
  let app: INestApplication;
  let owner: pg.Pool;
  let a: Tenant;
  let b: Tenant;
  let ticketA1: string; // raised by A's customer 1
  let ticketA2: string; // raised by A's customer 2
  let ticketB: string;
  const slugs: string[] = [];

  const createTicket = async (token: string, body: object) => {
    const res = await http(app)
      .post(`${API}/tickets`)
      .set(auth(token))
      .send(body);
    expect(res.status).toBe(201);
    return res.body.id as string;
  };
  const subjects = (res: { body: { items: { subject: string }[] } }) =>
    res.body.items.map((t) => t.subject).sort();

  beforeAll(async () => {
    app = await createTestApp();
    owner = ownerPool();
    a = await createTenant(app, 'a');
    b = await createTenant(app, 'b');
    slugs.push(a.slug, b.slug);
    ticketA1 = await createTicket(a.cust1, {
      subject: 'A1 printer broken',
      priority: 'HIGH',
    });
    ticketA2 = await createTicket(a.cust2, { subject: 'A2 cannot login' });
    ticketB = await createTicket(b.cust1, { subject: 'B1 roadmap question' });
  });

  afterAll(async () => {
    await deleteTenants(owner, slugs);
    await owner.end();
    await app.close();
  });

  describe('registration and login', () => {
    it('allows the same email in two organisations', async () => {
      // createTenant registers admin@shared.com in both A and B
      expect(a.admin).toBeTruthy();
      expect(b.admin).toBeTruthy();
    });

    it('rejects a duplicate organisation slug with 409 and leaves no orphan rows', async () => {
      const before = await owner.query('SELECT count(*)::int AS n FROM users');
      const res = await http(app).post(`${API}/auth/register-org`).send({
        orgName: 'Dup',
        orgSlug: a.slug,
        email: 'other@x.com',
        password: PASSWORD,
      });
      expect(res.status).toBe(409);
      const after = await owner.query('SELECT count(*)::int AS n FROM users');
      expect(after.rows[0].n).toBe(before.rows[0].n);
    });

    it('login needs the right organisation and gives the same 401 for a wrong org, email or password', async () => {
      const wrongOrg = await http(app)
        .post(`${API}/auth/login`)
        .send({
          orgSlug: uniqueSlug('none'),
          email: 'admin@shared.com',
          password: PASSWORD,
        });
      const wrongPw = await http(app).post(`${API}/auth/login`).send({
        orgSlug: a.slug,
        email: 'admin@shared.com',
        password: 'WrongPass1',
      });
      const wrongEmail = await http(app)
        .post(`${API}/auth/login`)
        .send({ orgSlug: a.slug, email: 'ghost@x.com', password: PASSWORD });
      for (const res of [wrongOrg, wrongPw, wrongEmail]) {
        expect(res.status).toBe(401);
        expect(res.body.message).toBe('Invalid credentials');
      }
    });

    it('puts userId, orgId and role in the token context', async () => {
      const res = await http(app).get(`${API}/auth/me`).set(auth(a.agent));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ orgId: a.orgId, role: 'AGENT' });
    });
  });

  describe('roles', () => {
    it('only an ADMIN can invite; AGENT and CUSTOMER get 403', async () => {
      const body = { email: 'e@x.com', password: PASSWORD, role: 'AGENT' };
      expect(
        (
          await http(app)
            .post(`${API}/auth/invite`)
            .set(auth(a.agent))
            .send(body)
        ).status,
      ).toBe(403);
      expect(
        (
          await http(app)
            .post(`${API}/auth/invite`)
            .set(auth(a.cust1))
            .send(body)
        ).status,
      ).toBe(403);
    });

    it('an ADMIN cannot be created through invite', async () => {
      const res = await http(app)
        .post(`${API}/auth/invite`)
        .set(auth(a.admin))
        .send({ email: 'e@x.com', password: PASSWORD, role: 'ADMIN' });
      expect(res.status).toBe(400);
    });

    it('rejects an orgId in the body (tenant comes only from the token)', async () => {
      const res = await http(app)
        .post(`${API}/auth/invite`)
        .set(auth(a.admin))
        .send({
          email: 'e@x.com',
          password: PASSWORD,
          role: 'AGENT',
          orgId: b.orgId,
        });
      expect(res.status).toBe(400);
    });

    it('requires a token (401)', async () => {
      expect((await http(app).get(`${API}/tickets`)).status).toBe(401);
    });

    it('lets only customers raise tickets', async () => {
      expect(
        (
          await http(app)
            .post(`${API}/tickets`)
            .set(auth(a.agent))
            .send({ subject: 'x' })
        ).status,
      ).toBe(403);
    });

    it('lets only agents and admins change status', async () => {
      const res = await http(app)
        .patch(`${API}/tickets/${ticketA1}/status`)
        .set(auth(a.cust1))
        .send({ status: 'CLOSED' });
      expect(res.status).toBe(403);
    });
  });

  describe('ticket visibility', () => {
    it('a customer sees only their own tickets', async () => {
      expect(
        subjects(await http(app).get(`${API}/tickets`).set(auth(a.cust1))),
      ).toEqual(['A1 printer broken']);
      expect(
        subjects(await http(app).get(`${API}/tickets`).set(auth(a.cust2))),
      ).toEqual(['A2 cannot login']);
    });

    it("an agent sees the whole of their own organisation's queue and nothing of another's", async () => {
      expect(
        subjects(await http(app).get(`${API}/tickets`).set(auth(a.agent))),
      ).toEqual(['A1 printer broken', 'A2 cannot login']);
      expect(
        subjects(await http(app).get(`${API}/tickets`).set(auth(b.admin))),
      ).toEqual(['B1 roadmap question']);
    });

    it('sets the SLA deadline from the organisation, creation time plus sla_mins', async () => {
      const { rows } = await owner.query(
        `SELECT round(extract(epoch FROM (t.sla_deadline - t.created_at)) / 60)::int AS mins, o.sla_mins
           FROM tickets t JOIN organizations o ON o.id = t.org_id WHERE t.id = $1`,
        [ticketA1],
      );
      expect(rows[0].mins).toBe(rows[0].sla_mins);
    });

    it('defaults priority to MEDIUM and status to OPEN', async () => {
      const { rows } = await owner.query(
        'SELECT status, priority FROM tickets WHERE id = $1',
        [ticketA2],
      );
      expect(rows[0]).toEqual({ status: 'OPEN', priority: 'MEDIUM' });
    });
  });

  describe('pagination and filters', () => {
    it('returns total, page and limit and honours them', async () => {
      const res = await http(app)
        .get(`${API}/tickets?limit=1&page=2`)
        .set(auth(a.agent));
      expect(res.body).toMatchObject({ total: 2, page: 2, limit: 1 });
      expect(res.body.items).toHaveLength(1);
    });

    it('filters by priority', async () => {
      const res = await http(app)
        .get(`${API}/tickets?priority=HIGH`)
        .set(auth(a.agent));
      expect(res.body.total).toBe(1);
      expect(res.body.items[0].id).toBe(ticketA1);
    });

    it('rejects limit above 100 and unknown filter values with 400', async () => {
      expect(
        (await http(app).get(`${API}/tickets?limit=1000`).set(auth(a.agent)))
          .status,
      ).toBe(400);
      expect(
        (await http(app).get(`${API}/tickets?status=NOPE`).set(auth(a.agent)))
          .status,
      ).toBe(400);
    });
  });

  describe('reading one ticket (GET /tickets/:id)', () => {
    it('lets the owner, and any agent or admin of the same organisation, read it', async () => {
      for (const token of [a.cust1, a.agent, a.admin]) {
        const res = await http(app)
          .get(`${API}/tickets/${ticketA1}`)
          .set(auth(token));
        expect(res.status).toBe(200);
        expect(res.body.id).toBe(ticketA1);
        expect(res.body.subject).toBe('A1 printer broken');
      }
    });

    it("answers 404 for another organisation's users and for another customer's ticket", async () => {
      for (const token of [b.cust1, b.agent, b.admin, a.cust2]) {
        const res = await http(app)
          .get(`${API}/tickets/${ticketA1}`)
          .set(auth(token));
        expect(res.status).toBe(404);
      }
    });

    it('needs a token (401) and a UUID (400)', async () => {
      expect((await http(app).get(`${API}/tickets/${ticketA1}`)).status).toBe(
        401,
      );
      expect(
        (await http(app).get(`${API}/tickets/not-a-uuid`).set(auth(a.agent)))
          .status,
      ).toBe(400);
    });
  });

  describe('cross-tenant attempts (all 404, nothing changes)', () => {
    it("another organisation's agent and admin cannot change a ticket's status", async () => {
      for (const token of [b.agent, b.admin]) {
        const res = await http(app)
          .patch(`${API}/tickets/${ticketA1}/status`)
          .set(auth(token))
          .send({ status: 'CLOSED' });
        expect(res.status).toBe(404);
      }
    });

    it("another organisation cannot read or write a ticket's comments", async () => {
      for (const token of [b.agent, b.cust1]) {
        expect(
          (
            await http(app)
              .get(`${API}/tickets/${ticketA1}/comments`)
              .set(auth(token))
          ).status,
        ).toBe(404);
        expect(
          (
            await http(app)
              .post(`${API}/tickets/${ticketA1}/comments`)
              .set(auth(token))
              .send({ message: 'hi' })
          ).status,
        ).toBe(404);
      }
    });

    it('leaves the ticket untouched after those attempts', async () => {
      const { rows } = await owner.query(
        'SELECT status FROM tickets WHERE id = $1',
        [ticketA1],
      );
      expect(rows[0].status).toBe('OPEN');
    });

    it("a customer cannot see or comment on another customer's ticket in the same organisation", async () => {
      expect(
        (
          await http(app)
            .get(`${API}/tickets/${ticketA1}/comments`)
            .set(auth(a.cust2))
        ).status,
      ).toBe(404);
      expect(
        (
          await http(app)
            .post(`${API}/tickets/${ticketA1}/comments`)
            .set(auth(a.cust2))
            .send({ message: 'hi' })
        ).status,
      ).toBe(404);
    });
  });

  describe('status changes and the audit log', () => {
    it('an agent changes status and an audit row records old and new value', async () => {
      const res = await http(app)
        .patch(`${API}/tickets/${ticketA1}/status`)
        .set(auth(a.agent))
        .send({ status: 'IN_PROGRESS' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('IN_PROGRESS');
      const { rows } = await owner.query(
        'SELECT action, old_val, new_val FROM audit_logs WHERE ticket_id = $1',
        [ticketA1],
      );
      expect(rows).toEqual([
        { action: 'STATUS_CHANGED', old_val: 'OPEN', new_val: 'IN_PROGRESS' },
      ]);
    });

    it('setting the same status again writes no extra audit row', async () => {
      await http(app)
        .patch(`${API}/tickets/${ticketA1}/status`)
        .set(auth(a.agent))
        .send({ status: 'IN_PROGRESS' });
      const { rows } = await owner.query(
        'SELECT count(*)::int AS n FROM audit_logs WHERE ticket_id = $1',
        [ticketA1],
      );
      expect(rows[0].n).toBe(1);
    });
  });

  describe('comments and internal notes', () => {
    it('customers never receive internal notes; agents do', async () => {
      const post = (token: string, body: object) =>
        http(app)
          .post(`${API}/tickets/${ticketA1}/comments`)
          .set(auth(token))
          .send(body);
      expect(
        (await post(a.cust1, { message: 'It prints blank pages' })).status,
      ).toBe(201);
      expect(
        (
          await post(a.agent, {
            message: 'Old driver, escalate?',
            isInternalNote: true,
          })
        ).status,
      ).toBe(201);
      expect(
        (await post(a.agent, { message: 'Please reinstall the driver' }))
          .status,
      ).toBe(201);

      const asCustomer = await http(app)
        .get(`${API}/tickets/${ticketA1}/comments`)
        .set(auth(a.cust1));
      expect(asCustomer.body).toHaveLength(2);
      expect(
        asCustomer.body.every(
          (c: { isInternalNote: boolean }) => !c.isInternalNote,
        ),
      ).toBe(true);

      const asAgent = await http(app)
        .get(`${API}/tickets/${ticketA1}/comments`)
        .set(auth(a.agent));
      expect(asAgent.body).toHaveLength(3);
      expect(
        asAgent.body.some((c: { isInternalNote: boolean }) => c.isInternalNote),
      ).toBe(true);
    });

    it('a customer cannot post an internal note (403)', async () => {
      const res = await http(app)
        .post(`${API}/tickets/${ticketA1}/comments`)
        .set(auth(a.cust1))
        .send({ message: 'x', isInternalNote: true });
      expect(res.status).toBe(403);
    });

    it('takes the author from the token', async () => {
      const res = await http(app)
        .post(`${API}/tickets/${ticketA1}/comments`)
        .set(auth(a.agent))
        .send({ message: 'who am I' });
      const me = await http(app).get(`${API}/auth/me`).set(auth(a.agent));
      expect(res.body.authorId).toBe(me.body.userId);
    });

    it('shows who wrote each comment: staff see addresses, a customer sees their own and only the role of staff', async () => {
      type Author = {
        authorRole: string;
        authorEmail: string | null;
        isInternalNote: boolean;
      };
      const list = async (token: string) =>
        (
          await http(app)
            .get(`${API}/tickets/${ticketA1}/comments`)
            .set(auth(token))
        ).body as Author[];

      const asAgent = await list(a.agent);
      expect(
        asAgent.find((c) => c.authorRole === 'CUSTOMER')?.authorEmail,
      ).toBe('cust1@x.com');
      expect(asAgent.find((c) => c.authorRole === 'AGENT')?.authorEmail).toBe(
        'agent@x.com',
      );

      const asCustomer = await list(a.cust1);
      expect(
        asCustomer.find((c) => c.authorRole === 'CUSTOMER')?.authorEmail,
      ).toBe('cust1@x.com');
      const staffComments = asCustomer.filter((c) => c.authorRole === 'AGENT');
      expect(staffComments.length).toBeGreaterThan(0);
      expect(staffComments.every((c) => c.authorEmail === null)).toBe(true);
      // the agent's address appears nowhere in what the customer received
      expect(JSON.stringify(asCustomer)).not.toContain('agent@x.com');
    });

    it('returns the same author fields when a comment is created, with the same redaction', async () => {
      const post = (token: string) =>
        http(app)
          .post(`${API}/tickets/${ticketA1}/comments`)
          .set(auth(token))
          .send({ message: 'shape check' });
      const byAgent = await post(a.agent);
      expect(byAgent.body.authorRole).toBe('AGENT');
      expect(byAgent.body.authorEmail).toBe('agent@x.com');
      const byCustomer = await post(a.cust1);
      expect(byCustomer.body.authorRole).toBe('CUSTOMER');
      expect(byCustomer.body.authorEmail).toBe('cust1@x.com');
    });
  });

  describe('input validation', () => {
    it('rejects client-supplied orgId and requesterId on ticket creation', async () => {
      expect(
        (
          await http(app)
            .post(`${API}/tickets`)
            .set(auth(a.cust1))
            .send({ subject: 'x', orgId: b.orgId })
        ).status,
      ).toBe(400);
      expect(
        (
          await http(app)
            .post(`${API}/tickets`)
            .set(auth(a.cust1))
            .send({ subject: 'x', requesterId: 'abc' })
        ).status,
      ).toBe(400);
    });

    it('rejects blank subjects and messages with 400, not 500', async () => {
      expect(
        (
          await http(app)
            .post(`${API}/tickets`)
            .set(auth(a.cust1))
            .send({ subject: '   ' })
        ).status,
      ).toBe(400);
      expect(
        (
          await http(app)
            .post(`${API}/tickets/${ticketA1}/comments`)
            .set(auth(a.agent))
            .send({ message: '   ' })
        ).status,
      ).toBe(400);
    });

    it('rejects a non-UUID ticket id and an invalid status with 400', async () => {
      expect(
        (
          await http(app)
            .patch(`${API}/tickets/not-a-uuid/status`)
            .set(auth(a.agent))
            .send({ status: 'OPEN' })
        ).status,
      ).toBe(400);
      expect(
        (
          await http(app)
            .patch(`${API}/tickets/${ticketA1}/status`)
            .set(auth(a.agent))
            .send({ status: 'DONE' })
        ).status,
      ).toBe(400);
    });
  });

  it('keeps organisation B untouched by everything above', async () => {
    const { rows } = await owner.query(
      'SELECT subject, status FROM tickets WHERE id = $1',
      [ticketB],
    );
    expect(rows).toEqual([{ subject: 'B1 roadmap question', status: 'OPEN' }]);
    const { rows: counts } = await owner.query(
      'SELECT count(*)::int AS n FROM comments WHERE ticket_id = $1',
      [ticketB],
    );
    expect(counts[0].n).toBe(0);
    expect(ticketA2).toBeTruthy();
  });
});
