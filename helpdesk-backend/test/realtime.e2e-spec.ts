import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
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
const ALLOWED_ORIGIN = 'http://localhost:4311';

describe('live chat over WebSocket', () => {
  let app: INestApplication;
  let owner: pg.Pool;
  let baseUrl: string;
  let a: Tenant;
  let b: Tenant;
  let ticketA: string; // raised by A's customer 1
  let ticketB: string;
  const slugs: string[] = [];
  const open: Socket[] = [];

  const socketToken = async (accessToken: string) => {
    const res = await http(app)
      .post(`${API}/auth/socket-token`)
      .set(auth(accessToken));
    expect(res.status).toBe(200);
    return res.body.token as string;
  };

  /** Resolves when connected, rejects with the server's reason when refused. */
  const connectWith = (
    token: string | undefined,
    headers: Record<string, string> = { Origin: ALLOWED_ORIGIN },
  ) =>
    new Promise<Socket>((resolve, reject) => {
      const socket = io(`${baseUrl}/support`, {
        transports: ['websocket'],
        auth: token === undefined ? {} : { token },
        extraHeaders: headers,
        reconnection: false,
      });
      open.push(socket);
      socket.once('connect', () => resolve(socket));
      socket.once('connect_error', (err) => {
        socket.close();
        reject(err);
      });
    });
  const connectAs = async (accessToken: string) =>
    connectWith(await socketToken(accessToken));

  const emit = <T>(socket: Socket, event: string, payload: unknown) =>
    socket.timeout(3000).emitWithAck(event, payload) as Promise<T>;
  const join = (socket: Socket, ticketId: string) =>
    emit<{ ok: boolean; error?: string }>(socket, 'ticket:join', { ticketId });

  /** Records every payload of one event, so a test can later assert both "arrived" and "did not arrive". */
  const listen = <T = Record<string, unknown>>(
    socket: Socket,
    event: string,
  ) => {
    const seen: T[] = [];
    socket.on(event, (payload: T) => seen.push(payload));
    return seen;
  };
  const until = async (check: () => boolean, ms = 3000) => {
    const end = Date.now() + ms;
    while (!check() && Date.now() < end)
      await new Promise((r) => setTimeout(r, 25));
    expect(check()).toBe(true);
  };
  const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms)); // time for anything wrongly sent to arrive

  const postComment = (token: string, ticketId: string, body: object) =>
    http(app)
      .post(`${API}/tickets/${ticketId}/comments`)
      .set(auth(token))
      .send(body);

  beforeAll(async () => {
    app = await createTestApp();
    await app.listen(0);
    baseUrl = `http://localhost:${(app.getHttpServer().address() as { port: number }).port}`;
    owner = ownerPool();
    a = await createTenant(app, 'rta');
    b = await createTenant(app, 'rtb');
    slugs.push(a.slug, b.slug);
    const create = async (token: string, subject: string) =>
      (
        await http(app)
          .post(`${API}/tickets`)
          .set(auth(token))
          .send({ subject })
      ).body.id as string;
    ticketA = await create(a.cust1, 'Live chat A');
    ticketB = await create(b.cust1, 'Live chat B');
  });

  afterEach(() => {
    for (const socket of open.splice(0)) socket.close();
  });

  afterAll(async () => {
    await deleteTenants(owner, slugs);
    await owner.end();
    await app.close();
  });

  describe('getting in', () => {
    it('hands out a 60-second socket token to a logged-in user only', async () => {
      expect((await http(app).post(`${API}/auth/socket-token`)).status).toBe(
        401,
      );
      const res = await http(app)
        .post(`${API}/auth/socket-token`)
        .set(auth(a.agent));
      expect(res.body.expiresIn).toBe(60);
      const claims = app
        .get(JwtService, { strict: false })
        .decode(res.body.token);
      expect(claims.purpose).toBe('socket');
      expect(claims.exp - claims.iat).toBe(60);
      expect(claims.sessionExp).toBeGreaterThan(claims.exp); // the session outlives the 60-second token
    });

    it('accepts a socket token, and a socket token is useless against the REST API', async () => {
      const token = await socketToken(a.agent);
      const socket = await connectWith(token);
      expect(socket.connected).toBe(true);
      expect(
        (await http(app).get(`${API}/auth/me`).set(auth(token))).status,
      ).toBe(401);
      expect(
        (await http(app).get(`${API}/tickets`).set(auth(token))).status,
      ).toBe(401);
    });

    it('refuses the long-lived login token, no token, garbage and a forged token, all with the same error', async () => {
      const forgedWith = (secret: string) =>
        new JwtService({ secret }).sign(
          {
            sub: 'x',
            orgId: 'y',
            role: 'ADMIN',
            sid: 'forged',
            purpose: 'socket',
          },
          { expiresIn: 60 },
        );
      for (const token of [
        a.agent,
        undefined,
        'abc.def.ghi',
        forgedWith('not-the-secret'),
      ]) {
        await expect(connectWith(token)).rejects.toThrow('unauthorized');
      }
    });

    it('refuses an expired socket token', async () => {
      const expired = app
        .get(JwtService, { strict: false })
        .sign(
          {
            sub: 'x',
            orgId: 'y',
            role: 'AGENT',
            sid: 'expired',
            purpose: 'socket',
          },
          { expiresIn: -5 },
        );
      await expect(connectWith(expired)).rejects.toThrow('unauthorized');
    });

    it('refuses a browser page from another origin, even with a perfectly good token', async () => {
      const token = await socketToken(a.agent);
      await expect(
        connectWith(token, { Origin: 'http://evil.example' }),
      ).rejects.toThrow('unauthorized');
      await expect(
        connectWith(token, { Origin: ALLOWED_ORIGIN }),
      ).resolves.toBeDefined();
    });

    it('drops the socket when the login session it came from ends', async () => {
      const jwt = app.get(JwtService, { strict: false });
      const sessionExp = Math.floor(Date.now() / 1000) + 2;
      // A real user: the handshake also checks the account still exists and is active.
      const agentId = (
        await http(app).get('/api/v1/auth/me').set(auth(a.agent))
      ).body.userId as string;
      const token = jwt.sign(
        {
          sub: agentId,
          orgId: a.orgId,
          role: 'AGENT',
          sid: 'session-expiry-test',
          purpose: 'socket',
          sessionExp,
        },
        { expiresIn: 60 },
      );
      const socket = await connectWith(token);
      const expired = listen(socket, 'session:expired');
      await until(() => !socket.connected, 5000);
      expect(expired).toHaveLength(1);
    });
  });

  describe('joining a ticket', () => {
    it("lets the ticket's customer and the org's staff in", async () => {
      for (const token of [a.cust1, a.agent, a.admin]) {
        expect(await join(await connectAs(token), ticketA)).toEqual({
          ok: true,
        });
      }
    });

    it('refuses another customer, another organisation, and a made-up id, with the same answer', async () => {
      const expected = { ok: false, error: 'Ticket not found' };
      expect(await join(await connectAs(a.cust2), ticketA)).toEqual(expected);
      expect(await join(await connectAs(b.agent), ticketA)).toEqual(expected);
      expect(await join(await connectAs(b.admin), ticketA)).toEqual(expected);
      expect(
        await join(
          await connectAs(a.agent),
          '00000000-0000-4000-8000-000000000000',
        ),
      ).toEqual(expected);
    });

    it('rejects a malformed ticket id', async () => {
      expect(await join(await connectAs(a.agent), 'nope')).toEqual({
        ok: false,
        error: 'Invalid ticket id',
      });
      expect(await emit(await connectAs(a.agent), 'ticket:join', null)).toEqual(
        { ok: false, error: 'Invalid ticket id' },
      );
    });
  });

  describe('who receives what', () => {
    it("delivers a public reply to the ticket's viewers only, and keeps staff addresses from the customer", async () => {
      const cust1 = await connectAs(a.cust1);
      const agent = await connectAs(a.agent);
      const cust2 = await connectAs(a.cust2); // same org, not their ticket
      const agentB = await connectAs(b.agent);
      await join(cust1, ticketA);
      await join(agent, ticketA);
      await join(agentB, ticketB);
      const toCust1 = listen<{
        message: string;
        authorEmail: string | null;
        authorRole: string;
      }>(cust1, 'comment:new');
      const toAgent = listen<{ message: string; authorEmail: string | null }>(
        agent,
        'comment:new',
      );
      const toCust2 = listen(cust2, 'comment:new');
      const toAgentB = listen(agentB, 'comment:new');

      const res = await postComment(a.agent, ticketA, {
        message: 'We are on it',
      });
      expect(res.status).toBe(201);
      await until(() => toCust1.length === 1 && toAgent.length === 1);
      await settle();

      expect(toAgent[0].authorEmail).toBe('agent@x.com'); // staff see who wrote it
      expect(toCust1[0]).toMatchObject({
        message: 'We are on it',
        authorRole: 'AGENT',
        authorEmail: null,
      });
      expect(JSON.stringify(toCust1)).not.toContain('agent@x.com');
      expect(toCust2).toHaveLength(0);
      expect(toAgentB).toHaveLength(0);
    });

    it("delivers an internal note to staff only: the customer's socket never hears it", async () => {
      const cust1 = await connectAs(a.cust1);
      const agent = await connectAs(a.agent);
      const admin = await connectAs(a.admin);
      await join(cust1, ticketA);
      await join(agent, ticketA);
      await join(admin, ticketA);
      const toCust1 = listen<{ message: string }>(cust1, 'comment:new');
      const toAgent = listen<{ message: string; isInternalNote: boolean }>(
        agent,
        'comment:new',
      );
      const toAdmin = listen<{ message: string }>(admin, 'comment:new');

      const res = await postComment(a.admin, ticketA, {
        message: 'SECRET: refund approved',
        isInternalNote: true,
      });
      expect(res.status).toBe(201);
      await until(() => toAgent.length === 1 && toAdmin.length === 1);
      await settle();

      expect(toAgent[0].isInternalNote).toBe(true);
      expect(toCust1).toHaveLength(0);
    });

    it("a customer's reply reaches the staff with the customer's address, and reaches the customer's other tab", async () => {
      const tabOne = await connectAs(a.cust1);
      const tabTwo = await connectAs(a.cust1);
      const agent = await connectAs(a.agent);
      for (const socket of [tabOne, tabTwo, agent]) await join(socket, ticketA);
      const toTwo = listen<{ authorEmail: string }>(tabTwo, 'comment:new');
      const toAgent = listen<{ authorEmail: string; authorRole: string }>(
        agent,
        'comment:new',
      );

      await postComment(a.cust1, ticketA, { message: 'Any news?' });
      await until(() => toTwo.length === 1 && toAgent.length === 1);

      expect(toAgent[0]).toMatchObject({
        authorEmail: 'cust1@x.com',
        authorRole: 'CUSTOMER',
      });
      expect(toTwo[0].authorEmail).toBe('cust1@x.com'); // their own address is theirs to see
    });

    it("sends a status change to the ticket's viewers and to the org's staff, and nowhere else; no change, no event", async () => {
      const cust1 = await connectAs(a.cust1);
      const cust2 = await connectAs(a.cust2);
      const agentWatching = await connectAs(a.agent);
      const agentQueue = await connectAs(a.admin); // connected, but not on the ticket page
      const agentB = await connectAs(b.agent);
      await join(cust1, ticketA);
      await join(agentWatching, ticketA);
      const heard = [cust1, cust2, agentWatching, agentQueue, agentB].map((s) =>
        listen<{ ticketId: string; status: string }>(s, 'ticket:status'),
      );

      const patch = (status: string) =>
        http(app)
          .patch(`${API}/tickets/${ticketA}/status`)
          .set(auth(a.agent))
          .send({ status });
      expect((await patch('IN_PROGRESS')).status).toBe(200);
      await until(
        () =>
          heard[0].length === 1 &&
          heard[2].length === 1 &&
          heard[3].length === 1,
      );
      await settle();
      expect(heard[0][0]).toEqual({ ticketId: ticketA, status: 'IN_PROGRESS' });
      expect(heard[1]).toHaveLength(0); // another customer
      expect(heard[4]).toHaveLength(0); // another organisation
      expect(heard[2]).toHaveLength(1); // watching staff hear it once, not once per room

      await patch('IN_PROGRESS'); // same status again
      await settle();
      expect(heard[0]).toHaveLength(1);
    });
  });

  describe('typing indicators', () => {
    it('shows typing to the other side, never back to the typist', async () => {
      const cust1 = await connectAs(a.cust1);
      const agent = await connectAs(a.agent);
      await join(cust1, ticketA);
      await join(agent, ticketA);
      const toAgent = listen<{
        role: string;
        isTyping: boolean;
        isInternalNote: boolean;
      }>(agent, 'typing');
      const toCust = listen<{ role: string }>(cust1, 'typing');

      expect(
        await emit(cust1, 'typing', { ticketId: ticketA, isTyping: true }),
      ).toEqual({ ok: true });
      await until(() => toAgent.length === 1);
      expect(toAgent[0]).toMatchObject({
        role: 'CUSTOMER',
        isTyping: true,
        isInternalNote: false,
      });
      await emit(agent, 'typing', { ticketId: ticketA, isTyping: true });
      await until(() => toCust.length === 1);
      expect(toCust[0].role).toBe('AGENT');
      expect(toCust).toHaveLength(1);
    });

    it('keeps "typing an internal note" from the customer, and a customer cannot fake one', async () => {
      const cust1 = await connectAs(a.cust1);
      const agent = await connectAs(a.agent);
      const admin = await connectAs(a.admin);
      for (const socket of [cust1, agent, admin]) await join(socket, ticketA);
      const toCust = listen(cust1, 'typing');
      const toAdmin = listen<{ isInternalNote: boolean }>(admin, 'typing');
      const toAgent = listen<{ isInternalNote: boolean; role: string }>(
        agent,
        'typing',
      );

      await emit(agent, 'typing', {
        ticketId: ticketA,
        isTyping: true,
        isInternalNote: true,
      });
      await until(() => toAdmin.length === 1);
      await settle();
      expect(toAdmin[0].isInternalNote).toBe(true);
      expect(toCust).toHaveLength(0);

      await emit(cust1, 'typing', {
        ticketId: ticketA,
        isTyping: true,
        isInternalNote: true,
      });
      await until(() => toAgent.length === 1);
      expect(toAgent[0]).toMatchObject({
        role: 'CUSTOMER',
        isInternalNote: false,
      }); // treated as a public reply
    });

    it('needs a joined ticket and a well-formed event', async () => {
      const stranger = await connectAs(a.cust2);
      expect(
        await emit(stranger, 'typing', { ticketId: ticketA, isTyping: true }),
      ).toEqual({ ok: false, error: 'Join the ticket first' });
      expect(
        await emit(stranger, 'typing', { ticketId: ticketA, isTyping: 'yes' }),
      ).toEqual({ ok: false, error: 'Invalid typing event' });
    });
  });

  it('stops delivery after leaving a ticket', async () => {
    const cust1 = await connectAs(a.cust1);
    await join(cust1, ticketA);
    expect(await emit(cust1, 'ticket:leave', { ticketId: ticketA })).toEqual({
      ok: true,
    });
    const heard = listen(cust1, 'comment:new');
    await postComment(a.agent, ticketA, { message: 'after you left' });
    await settle();
    expect(heard).toHaveLength(0);
  });

  it('still saves and returns comments and status changes when nobody is listening', async () => {
    expect(
      (await postComment(a.agent, ticketA, { message: 'quiet room' })).status,
    ).toBe(201);
    const res = await http(app)
      .patch(`${API}/tickets/${ticketA}/status`)
      .set(auth(a.agent))
      .send({ status: 'RESOLVED' });
    expect(res.status).toBe(200);
  });
});
