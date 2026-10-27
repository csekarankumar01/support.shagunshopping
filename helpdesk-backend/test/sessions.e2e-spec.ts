import { INestApplication } from '@nestjs/common';
import pg from 'pg';
import { io, Socket } from 'socket.io-client';
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
const MAIL = `http://localhost:${process.env.MAIL_UI_PORT ?? 4026}`;

interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

describe('sessions, revocation, password flows and member management', () => {
  let app: INestApplication;
  let owner: pg.Pool;
  let baseUrl: string;
  let a: Tenant;
  let b: Tenant;
  const slugs: string[] = [];
  const mailIds: string[] = [];
  const sockets: Socket[] = [];

  const login = (tenant: Tenant, email: string, password = PASSWORD) =>
    http(app)
      .post(`${API}/auth/login`)
      .send({ orgSlug: tenant.slug, email, password });
  const session = async (tenant: Tenant, email: string) =>
    (await login(tenant, email).expect(200)).body as Tokens;
  const me = (token: string) =>
    http(app).get(`${API}/auth/me`).set(auth(token));
  const refresh = (refreshToken: string) =>
    http(app).post(`${API}/auth/refresh`).send({ refreshToken });
  const idOf = async (email: string) =>
    (
      (await http(app).get(`${API}/team`).set(auth(a.admin))).body as {
        userId: string;
        email: string;
      }[]
    ).find((m) => m.email === email)!.userId;
  const userId = async (token: string) =>
    (await me(token)).body.userId as string;
  const patchMember = (token: string, id: string, body: object) =>
    http(app).patch(`${API}/team/${id}`).set(auth(token)).send(body);
  const until = async (check: () => Promise<boolean>, ms = 15_000) => {
    const end = Date.now() + ms;
    while (!(await check()) && Date.now() < end)
      await new Promise((r) => setTimeout(r, 150));
    expect(await check()).toBe(true);
  };

  /** The newest email to `to` whose subject contains `subject`, with its text. Null until it has arrived. */
  const mailTo = async (to: string, subject: string) => {
    const { messages } = (await (
      await fetch(`${MAIL}/api/v1/messages?limit=200`)
    ).json()) as {
      messages: { ID: string; Subject: string; To: { Address: string }[] }[];
    };
    const found = messages.find(
      (m) => m.Subject.includes(subject) && m.To.some((t) => t.Address === to),
    );
    if (!found) return null;
    mailIds.push(found.ID);
    const full = (await (
      await fetch(`${MAIL}/api/v1/message/${found.ID}`)
    ).json()) as { Text: string };
    return full.Text;
  };
  const linkToken = (mail: string) =>
    decodeURIComponent(/token=([^\s]+)/.exec(mail)![1]);
  const unique = () =>
    `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  beforeAll(async () => {
    app = await createTestApp();
    await app.listen(0);
    baseUrl = `http://localhost:${(app.getHttpServer().address() as { port: number }).port}`;
    owner = ownerPool();
    a = await createTenant(app, 'sa');
    b = await createTenant(app, 'sb');
    slugs.push(a.slug, b.slug);
  });

  afterEach(() => {
    for (const socket of sockets.splice(0)) socket.close();
  });

  afterAll(async () => {
    await fetch(`${MAIL}/api/v1/messages`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ IDs: [...new Set(mailIds)] }),
    }).catch(() => undefined);
    await owner.query(
      `DELETE FROM password_resets WHERE org_id IN (SELECT id FROM organizations WHERE slug = ANY($1))`,
      [slugs],
    );
    await owner.query(
      `DELETE FROM refresh_tokens WHERE org_id IN (SELECT id FROM organizations WHERE slug = ANY($1))`,
      [slugs],
    );
    await deleteTenants(owner, slugs);
    await owner.end();
    await app.close();
  });

  describe('login and refresh tokens', () => {
    it('gives a short-lived access token and an opaque refresh token that starts with the org id', async () => {
      const t = await session(a, 'cust1@x.com');
      expect(t.expiresIn).toBe(Number(process.env.JWT_EXPIRES_IN_SECONDS));
      expect(t.refreshToken).toMatch(
        new RegExp(`^${a.orgId}\\.[A-Za-z0-9_-]{43}$`),
      );
      expect((await me(t.accessToken)).status).toBe(200);
    });

    it('stores only a hash of the refresh token', async () => {
      const t = await session(a, 'cust1@x.com');
      const { rows } = await owner.query(
        `SELECT token_hash FROM refresh_tokens WHERE org_id = $1 ORDER BY created_at DESC LIMIT 20`,
        [a.orgId],
      );
      const stored = rows.map((r) => r.token_hash as string);
      expect(
        stored.some(
          (h) =>
            t.refreshToken.includes(h) ||
            h.includes(t.refreshToken.split('.')[1]),
        ),
      ).toBe(false);
      expect(stored.every((h) => /^[0-9a-f]{64}$/.test(h))).toBe(true);
    });

    it('rotates: a refresh returns a new pair that works, with the same session', async () => {
      const t = await session(a, 'cust1@x.com');
      const next = (await refresh(t.refreshToken).expect(200)).body as Tokens;
      expect(next.refreshToken).not.toBe(t.refreshToken);
      expect((await me(next.accessToken)).status).toBe(200);
      const sid = (token: string) =>
        JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
          .sid;
      expect(sid(next.accessToken)).toBe(sid(t.accessToken));
    });

    it('tolerates two requests refreshing with the same token at the same moment', async () => {
      const t = await session(a, 'cust1@x.com');
      const [one, two] = await Promise.all([
        refresh(t.refreshToken),
        refresh(t.refreshToken),
      ]);
      expect([one.status, two.status]).toEqual([200, 200]);
    });

    it('treats an old token coming back after the grace period as theft and revokes the whole session', async () => {
      const t = await session(a, 'cust1@x.com');
      const stolen = t.refreshToken;
      const rotated = (await refresh(stolen).expect(200)).body as Tokens;
      await owner.query(
        `UPDATE refresh_tokens SET rotated_at = now() - interval '1 minute' WHERE org_id = $1 AND rotated_at IS NOT NULL`,
        [a.orgId],
      );
      expect((await refresh(stolen)).status).toBe(401); // the replay
      expect((await refresh(rotated.refreshToken)).status).toBe(401); // the real owner is signed out too
      expect((await me(rotated.accessToken)).status).toBe(401); // and their access token stops working at once
    });

    it("leaves a user's other sessions alone when one is revoked", async () => {
      const phone = await session(a, 'cust1@x.com');
      const laptop = await session(a, 'cust1@x.com');
      await http(app)
        .post(`${API}/auth/logout`)
        .send({ refreshToken: phone.refreshToken })
        .expect(200);
      expect((await me(phone.accessToken)).status).toBe(401);
      expect((await me(laptop.accessToken)).status).toBe(200);
      expect((await refresh(laptop.refreshToken)).status).toBe(200);
    });

    it('refuses garbage, a token for another organisation, an expired one and a missing body', async () => {
      const t = await session(a, 'cust1@x.com');
      expect((await refresh('nonsense')).status).toBe(401);
      const foreign = t.refreshToken.replace(a.orgId, b.orgId);
      expect((await refresh(foreign)).status).toBe(401);
      await owner.query(
        `UPDATE refresh_tokens SET expires_at = now() - interval '1 second' WHERE org_id = $1 AND token_hash = encode(sha256($2::bytea), 'hex')`,
        [a.orgId, t.refreshToken],
      );
      expect((await refresh(t.refreshToken)).status).toBe(401);
      expect(
        (await http(app).post(`${API}/auth/refresh`).send({})).status,
      ).toBe(400);
    });

    it('never lets a session outlive 30 days, however often it is refreshed', async () => {
      const t = await session(a, 'cust1@x.com');
      await owner.query(
        `UPDATE refresh_tokens SET family_started_at = now() - interval '29 days 23 hours' WHERE org_id = $1 AND token_hash = encode(sha256($2::bytea), 'hex')`,
        [a.orgId, t.refreshToken],
      );
      const next = (await refresh(t.refreshToken).expect(200)).body as Tokens;
      const { rows } = await owner.query(
        `SELECT extract(epoch FROM expires_at - family_started_at) / 86400 AS days
           FROM refresh_tokens WHERE org_id = $1 AND token_hash = encode(sha256($2::bytea), 'hex')`,
        [a.orgId, next.refreshToken],
      );
      expect(Number(rows[0].days)).toBeLessThanOrEqual(30.001);
    });
  });

  describe('logout', () => {
    it('ends the session at once: the access token and the refresh token both stop working', async () => {
      const t = await session(a, 'agent@x.com');
      expect(
        (
          await http(app)
            .post(`${API}/auth/logout`)
            .send({ refreshToken: t.refreshToken })
        ).body,
      ).toEqual({ ok: true });
      expect((await me(t.accessToken)).status).toBe(401);
      expect((await refresh(t.refreshToken)).status).toBe(401);
    });

    it('answers the same for an unknown token', async () => {
      expect(
        (
          await http(app)
            .post(`${API}/auth/logout`)
            .send({ refreshToken: 'nonsense' })
        ).status,
      ).toBe(200);
    });

    it('"sign out everywhere" ends every session of the user, not anyone else\'s', async () => {
      const one = await session(a, 'cust2@x.com');
      const two = await session(a, 'cust2@x.com');
      const other = await session(a, 'cust1@x.com');
      await http(app)
        .post(`${API}/auth/logout-all`)
        .set(auth(one.accessToken))
        .expect(200);
      expect((await me(one.accessToken)).status).toBe(401);
      expect((await me(two.accessToken)).status).toBe(401);
      expect((await refresh(two.refreshToken)).status).toBe(401);
      expect((await me(other.accessToken)).status).toBe(200);
    });
  });

  describe('deactivating and changing members (admin only)', () => {
    it('cuts a deactivated person off immediately and blocks login and refresh until reactivated', async () => {
      const t = await session(a, 'cust2@x.com');
      const id = await userId(t.accessToken);
      expect(
        (await patchMember(a.admin, id, { isActive: false })).body,
      ).toMatchObject({ isActive: false });
      expect((await me(t.accessToken)).status).toBe(401); // even though the token has not expired
      expect((await refresh(t.refreshToken)).status).toBe(401);
      const refused = await login(a, 'cust2@x.com');
      expect(refused.status).toBe(401);
      expect(refused.body.message).toBe('Invalid credentials'); // no hint that the account exists
      expect(
        (await patchMember(a.admin, id, { isActive: true })).body,
      ).toMatchObject({ isActive: true });
      expect((await login(a, 'cust2@x.com')).status).toBe(200);
    });

    it("hands a deactivated agent's open tickets back to the queue, with an audit entry", async () => {
      const ticket = (
        await http(app)
          .post(`${API}/tickets`)
          .set(auth(a.cust1))
          .send({ subject: 'Needs an agent' })
          .expect(201)
      ).body.id as string;
      const agentId = await userId(a.agent);
      await http(app)
        .patch(`${API}/tickets/${ticket}/assign`)
        .set(auth(a.agent))
        .send({ agentId })
        .expect(200);
      const fresh = await session(a, 'agent@x.com');
      await patchMember(a.admin, agentId, { isActive: false }).expect(200);
      expect((await me(fresh.accessToken)).status).toBe(401);
      const after = await owner.query(
        'SELECT agent_id FROM tickets WHERE id = $1',
        [ticket],
      );
      expect(after.rows[0].agent_id).toBeNull();
      const audit = await owner.query(
        `SELECT old_val, new_val FROM audit_logs WHERE ticket_id = $1 AND action = 'ASSIGNED' ORDER BY created_at DESC LIMIT 1`,
        [ticket],
      );
      expect(audit.rows[0]).toEqual({ old_val: agentId, new_val: null });
      await patchMember(a.admin, agentId, { isActive: true }).expect(200);
      expect((await login(a, 'agent@x.com')).status).toBe(200);
    });

    it('changing a role takes effect at once: the old sessions end and the next login has the new role', async () => {
      const t = await session(a, 'agent@x.com');
      const id = await userId(t.accessToken);
      await patchMember(a.admin, id, { role: 'CUSTOMER' }).expect(200);
      expect((await me(t.accessToken)).status).toBe(401);
      const fresh = await session(a, 'agent@x.com');
      expect((await me(fresh.accessToken)).body.role).toBe('CUSTOMER');
      expect(
        (
          await http(app)
            .get(`${API}/tickets/stats`)
            .set(auth(fresh.accessToken))
        ).status,
      ).toBe(403);
      await patchMember(a.admin, id, { role: 'AGENT' }).expect(200);
    });

    it('protects the organisation: not yourself, not another admin, only admins, only your own organisation', async () => {
      const adminId = await userId(a.admin);
      const custId = await idOf('cust1@x.com');
      const agentNow = await session(a, 'agent@x.com');
      const custNow = await session(a, 'cust1@x.com');
      expect(
        (await patchMember(a.admin, adminId, { isActive: false })).status,
      ).toBe(403);
      expect(
        (await patchMember(agentNow.accessToken, custId, { isActive: false }))
          .status,
      ).toBe(403);
      expect(
        (await patchMember(custNow.accessToken, custId, { isActive: false }))
          .status,
      ).toBe(403);
      expect(
        (await patchMember(b.admin, custId, { isActive: false })).status,
      ).toBe(404); // another organisation
      expect(
        (
          await patchMember(a.admin, '00000000-0000-4000-8000-000000000000', {
            isActive: false,
          })
        ).status,
      ).toBe(404);
      expect(
        (await patchMember(a.admin, custId, { role: 'ADMIN' })).status,
      ).toBe(400); // admins only come from registering
      expect(
        (await patchMember(a.admin, custId, { orgId: b.orgId })).status,
      ).toBe(400);
      expect((await me(custNow.accessToken)).status).toBe(200); // none of that changed anything
    });

    it('lists whether members are active, and shows agents only active staff', async () => {
      const id = await idOf('cust2@x.com');
      const agentNow = await session(a, 'agent@x.com');
      await patchMember(a.admin, id, { isActive: false }).expect(200);
      const asAdmin = (await http(app).get(`${API}/team`).set(auth(a.admin)))
        .body as { email: string; isActive: boolean }[];
      expect(asAdmin.find((m) => m.email === 'cust2@x.com')?.isActive).toBe(
        false,
      );
      const asAgent = (
        await http(app).get(`${API}/team`).set(auth(agentNow.accessToken))
      ).body as { email: string }[];
      expect(asAgent.map((m) => m.email)).toEqual([
        'admin@shared.com',
        'agent@x.com',
      ]);
      await patchMember(a.admin, id, { isActive: true }).expect(200);
    });
  });

  describe('changing your own password', () => {
    it('needs the current password, enforces the length rules, and signs out your other devices only', async () => {
      const here = await session(a, 'cust1@x.com');
      const elsewhere = await session(a, 'cust1@x.com');
      const change = (token: string, body: object) =>
        http(app)
          .post(`${API}/auth/change-password`)
          .set(auth(token))
          .send(body);

      expect(
        (
          await change(here.accessToken, {
            currentPassword: 'wrong',
            newPassword: 'Another123',
          })
        ).status,
      ).toBe(400); // not 401: the user IS logged in, and the web app reads a 401 as "session ended"
      expect(
        (
          await change(here.accessToken, {
            currentPassword: PASSWORD,
            newPassword: 'short',
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await change(here.accessToken, {
            currentPassword: PASSWORD,
            newPassword: 'x'.repeat(73),
          })
        ).status,
      ).toBe(400); // bcrypt would ignore the tail
      expect(
        (
          await change(here.accessToken, {
            currentPassword: PASSWORD,
            newPassword: 'Another123',
          })
        ).status,
      ).toBe(200);

      expect((await me(here.accessToken)).status).toBe(200); // this device stays signed in
      expect((await me(elsewhere.accessToken)).status).toBe(401); // the others are signed out
      expect((await login(a, 'cust1@x.com')).status).toBe(401); // the old password is dead
      expect((await login(a, 'cust1@x.com', 'Another123')).status).toBe(200);
      await http(app)
        .post(`${API}/auth/change-password`)
        .set(auth(here.accessToken))
        .send({ currentPassword: 'Another123', newPassword: PASSWORD })
        .expect(200);
    });
  });

  describe('forgotten password', () => {
    it('answers identically whether or not the account exists, and emails only real, active accounts', async () => {
      const real = await http(app)
        .post(`${API}/auth/forgot-password`)
        .send({ orgSlug: a.slug, email: 'cust1@x.com' });
      const unknown = await http(app)
        .post(`${API}/auth/forgot-password`)
        .send({ orgSlug: a.slug, email: `nobody-${unique()}@x.com` });
      const noOrg = await http(app)
        .post(`${API}/auth/forgot-password`)
        .send({ orgSlug: 'no-such-org', email: 'cust1@x.com' });
      for (const res of [real, unknown, noOrg]) {
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ ok: true });
      }
      let mail: string | null = null;
      await until(
        async () =>
          (mail = await mailTo('cust1@x.com', 'Reset your password')) !== null,
      );
      expect(mail).toContain('/reset-password?token=');
    });

    it('sets a new password from the emailed link, once, and signs out every old session', async () => {
      const old = await session(a, 'cust2@x.com');
      await http(app)
        .post(`${API}/auth/forgot-password`)
        .send({ orgSlug: a.slug, email: 'cust2@x.com' })
        .expect(200);
      let mail: string | null = null;
      await until(
        async () =>
          (mail = await mailTo('cust2@x.com', 'Reset your password')) !== null,
      );
      const token = linkToken(mail!);

      const reset = (body: object) =>
        http(app).post(`${API}/auth/reset-password`).send(body);
      expect((await reset({ token, newPassword: 'short' })).status).toBe(400);
      expect(
        (await reset({ token: 'garbage', newPassword: 'Brand-new-1' })).status,
      ).toBe(400);
      expect((await reset({ token, newPassword: 'Brand-new-1' })).status).toBe(
        200,
      );

      expect((await reset({ token, newPassword: 'Used-twice-1' })).status).toBe(
        400,
      ); // single use
      expect((await me(old.accessToken)).status).toBe(401);
      expect((await refresh(old.refreshToken)).status).toBe(401);
      expect((await login(a, 'cust2@x.com')).status).toBe(401);
      expect((await login(a, 'cust2@x.com', 'Brand-new-1')).status).toBe(200);
      await owner.query(`UPDATE password_resets SET used_at = used_at`); // (keeps the table tidy for the next test)
      // put the shared test password back for later tests
      const back = await session(a, 'cust2@x.com').catch(() => null);
      expect(back).toBeNull(); // PASSWORD no longer works: the reset really replaced it
    });

    it('expires after an hour and stops working when a newer link is requested', async () => {
      await http(app)
        .post(`${API}/auth/forgot-password`)
        .send({ orgSlug: b.slug, email: 'cust1@x.com' })
        .expect(200);
      let first: string | null = null;
      await until(
        async () =>
          (first = await mailTo('cust1@x.com', 'Reset your password')) !==
            null && linkToken(first).startsWith(b.orgId),
      );
      const oldLink = linkToken(first!);
      await http(app)
        .post(`${API}/auth/forgot-password`)
        .send({ orgSlug: b.slug, email: 'cust1@x.com' })
        .expect(200);
      await until(async () => {
        const { rows } = await owner.query(
          `SELECT count(*)::int AS n FROM password_resets WHERE org_id = $1 AND used_at IS NULL`,
          [b.orgId],
        );
        return rows[0].n === 1;
      });
      expect(
        (
          await http(app)
            .post(`${API}/auth/reset-password`)
            .send({ token: oldLink, newPassword: 'Brand-new-1' })
        ).status,
      ).toBe(400); // replaced by the newer link

      // the newer link works until it is an hour old, then it does not
      let newest = '';
      await until(async () => {
        const mail = await mailTo('cust1@x.com', 'Reset your password');
        if (!mail) return false;
        newest = linkToken(mail);
        return newest !== oldLink && newest.startsWith(b.orgId);
      });
      await owner.query(
        `UPDATE password_resets SET expires_at = now() - interval '1 second' WHERE org_id = $1`,
        [b.orgId],
      );
      expect(
        (
          await http(app)
            .post(`${API}/auth/reset-password`)
            .send({ token: newest, newPassword: 'Brand-new-1' })
        ).status,
      ).toBe(400);
    });
  });

  describe('invitations by email', () => {
    it('lets an admin invite without choosing a password: the person gets a link and sets their own', async () => {
      const email = `invited-${unique()}@x.com`;
      const res = await http(app)
        .post(`${API}/auth/invite`)
        .set(auth(a.admin))
        .send({ email, role: 'AGENT' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        email,
        role: 'AGENT',
        invitationSent: true,
      });
      expect(JSON.stringify(res.body)).not.toMatch(/password/i);

      let mail: string | null = null;
      await until(async () => (mail = await mailTo(email, 'invited')) !== null);
      expect((await login(a, email, 'whatever-guess')).status).toBe(401); // nobody knows the placeholder password
      await http(app)
        .post(`${API}/auth/reset-password`)
        .send({ token: linkToken(mail!), newPassword: 'My-own-pass-1' })
        .expect(200);
      const t = (await login(a, email, 'My-own-pass-1').expect(200))
        .body as Tokens;
      expect((await me(t.accessToken)).body.role).toBe('AGENT');
    });

    it('still accepts an explicit password, and rejects one that is too long', async () => {
      const ok = await http(app)
        .post(`${API}/auth/invite`)
        .set(auth(a.admin))
        .send({
          email: `explicit-${unique()}@x.com`,
          password: 'Chosen-by-admin',
          role: 'CUSTOMER',
        });
      expect(ok.status).toBe(201);
      expect(ok.body.invitationSent).toBeUndefined();
      const tooLong = await http(app)
        .post(`${API}/auth/invite`)
        .set(auth(a.admin))
        .send({
          email: `long-${unique()}@x.com`,
          password: 'x'.repeat(73),
          role: 'CUSTOMER',
        });
      expect(tooLong.status).toBe(400);
    });
  });

  describe('live sockets follow the session', () => {
    const connect = async (accessToken: string) => {
      const res = await http(app)
        .post(`${API}/auth/socket-token`)
        .set(auth(accessToken))
        .expect(200);
      return new Promise<Socket>((resolve, reject) => {
        const socket = io(`${baseUrl}/support`, {
          transports: ['websocket'],
          auth: { token: res.body.token },
          extraHeaders: { Origin: 'http://localhost:4311' },
          reconnection: false,
        });
        sockets.push(socket);
        socket.once('connect', () => resolve(socket));
        socket.once('connect_error', reject);
      });
    };

    it('disconnects an open socket the moment its session is logged out, and refuses a fresh handshake with that session', async () => {
      const t = await session(a, 'agent@x.com');
      const socketToken = (
        await http(app)
          .post(`${API}/auth/socket-token`)
          .set(auth(t.accessToken))
          .expect(200)
      ).body.token as string;
      const socket = await connect(t.accessToken);
      let expired = 0;
      socket.on('session:expired', () => expired++);
      await http(app)
        .post(`${API}/auth/logout`)
        .send({ refreshToken: t.refreshToken })
        .expect(200);
      await until(async () => !socket.connected);
      expect(expired).toBe(1);
      const retry = io(`${baseUrl}/support`, {
        transports: ['websocket'],
        auth: { token: socketToken },
        extraHeaders: { Origin: 'http://localhost:4311' },
        reconnection: false,
      });
      sockets.push(retry);
      await expect(
        new Promise((resolve, reject) => {
          retry.once('connect', () => resolve(undefined));
          retry.once('connect_error', reject);
        }),
      ).rejects.toThrow('unauthorized');
    });

    it("disconnects a deactivated member's sockets but nobody else's", async () => {
      const victim = await session(a, 'cust2@x.com').catch(async () => null);
      expect(victim).toBeNull(); // cust2's password was changed by the reset test above
      const t = await session(a, 'cust1@x.com');
      const bystander = await session(a, 'agent@x.com');
      const socket = await connect(t.accessToken);
      const other = await connect(bystander.accessToken);
      const id = await userId(t.accessToken);
      await patchMember(a.admin, id, { isActive: false }).expect(200);
      await until(async () => !socket.connected);
      expect(other.connected).toBe(true);
      await patchMember(a.admin, id, { isActive: true }).expect(200);
    });
  });
});
