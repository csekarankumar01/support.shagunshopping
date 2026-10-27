import { randomBytes } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import pg from 'pg';
import { MailerService } from '../src/mail/mailer.service.js';
import { createTestApp, deleteTenants, http, ownerPool, PASSWORD } from './helpers.js';

const API = '/api/v1/auth';

describe('sign-up with an emailed one-time code', () => {
  let app: INestApplication;
  let owner: pg.Pool;
  const slugs: string[] = [];
  const sent: { to: string; subject: string; body: string }[] = [];

  const newSlug = () => {
    const slug = `e2e-otp-${randomBytes(4).toString('hex')}`;
    slugs.push(slug);
    return slug;
  };
  const register = (orgSlug: string, email: string, password = PASSWORD) =>
    http(app).post(`${API}/register-org`).send({ orgName: 'OTP Org', orgSlug, email, password });
  const verify = (orgSlug: string, email: string, code: string) =>
    http(app).post(`${API}/verify-registration`).send({ orgSlug, email, code });
  /** The code from the most recent email to this address. */
  const lastCode = (to: string) => {
    const mail = [...sent].reverse().find((m) => m.to === to);
    expect(mail).toBeDefined();
    return /\b(\d{6})\b/.exec(mail!.subject)![1];
  };
  const wrongCode = (real: string) => (real === '000000' ? '111111' : '000000');
  const orgExists = async (slug: string) =>
    (await owner.query('SELECT 1 FROM organizations WHERE slug = $1', [slug])).rowCount === 1;
  const pending = async (slug: string) =>
    (await owner.query('SELECT * FROM pending_registrations WHERE org_slug = $1', [slug])).rows[0];
  /** Skips the one-minute wait between codes. */
  const skipCooldown = (slug: string) =>
    owner.query("UPDATE pending_registrations SET last_sent_at = now() - interval '2 minutes' WHERE org_slug = $1", [slug]);

  beforeAll(async () => {
    process.env.REQUIRE_EMAIL_VERIFICATION = 'true'; // on for this file only (setup-env turns it off for the others)
    owner = ownerPool();
    app = await createTestApp();
    vi.spyOn(app.get(MailerService), 'send').mockImplementation((to, subject, body) => {
      sent.push({ to, subject, body });
      return Promise.resolve();
    });
  });

  afterAll(async () => {
    await owner.query('DELETE FROM pending_registrations WHERE org_slug = ANY($1)', [slugs]);
    await deleteTenants(owner, slugs);
    await owner.end();
    await app.close();
  });

  it('creates nothing until the code is entered, then creates the organisation and a working admin', async () => {
    const slug = newSlug();
    const email = 'Owner@Example.com';
    const res = await register(slug, email);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ verificationRequired: true, email: 'owner@example.com', expiresInMinutes: 10 });
    expect(await orgExists(slug)).toBe(false);
    // Not signed in, and the password cannot be used yet.
    expect((await http(app).post(`${API}/login`).send({ orgSlug: slug, email, password: PASSWORD })).status).toBe(401);
    // The email carries the code, which is not stored in plain text.
    const code = lastCode('owner@example.com');
    const row = await pending(slug);
    expect(row.code_hash).not.toContain(code);
    expect(row.password_hash).not.toContain(PASSWORD);

    const done = await verify(slug, email, code);
    expect(done.status).toBe(201);
    expect(done.body).toMatchObject({ organization: { slug }, user: { email: 'owner@example.com', role: 'ADMIN' } });
    expect(await orgExists(slug)).toBe(true);
    expect(await pending(slug)).toBeUndefined();
    expect((await http(app).post(`${API}/login`).send({ orgSlug: slug, email, password: PASSWORD })).status).toBe(200);
  });

  it('a code works once', async () => {
    const slug = newSlug();
    await register(slug, 'once@example.com');
    const code = lastCode('once@example.com');
    expect((await verify(slug, 'once@example.com', code)).status).toBe(201);
    expect((await verify(slug, 'once@example.com', code)).status).toBe(400);
  });

  it('refuses a wrong code with one neutral message, and the right code still works afterwards', async () => {
    const slug = newSlug();
    await register(slug, 'wrong@example.com');
    const code = lastCode('wrong@example.com');
    const bad = await verify(slug, 'wrong@example.com', wrongCode(code));
    expect(bad.status).toBe(400);
    const unknown = await verify(slug, 'nobody@example.com', code);
    expect(unknown.status).toBe(400);
    expect(unknown.body.message).toBe(bad.body.message);
    expect((await verify(slug, 'wrong@example.com', 'abc')).status).toBe(400); // not even six digits
    expect((await verify(slug, 'wrong@example.com', code)).status).toBe(201);
  });

  it('throws the sign-up away after five wrong codes, even for the right code', async () => {
    const slug = newSlug();
    await register(slug, 'guess@example.com');
    const code = lastCode('guess@example.com');
    for (let i = 0; i < 5; i++) expect((await verify(slug, 'guess@example.com', wrongCode(code))).status).toBe(400);
    expect(await pending(slug)).toBeUndefined();
    expect((await verify(slug, 'guess@example.com', code)).status).toBe(400);
    expect(await orgExists(slug)).toBe(false);
  });

  it('an expired code is refused', async () => {
    const slug = newSlug();
    await register(slug, 'late@example.com');
    const code = lastCode('late@example.com');
    await owner.query("UPDATE pending_registrations SET expires_at = now() - interval '1 second' WHERE org_slug = $1", [slug]);
    expect((await verify(slug, 'late@example.com', code)).status).toBe(400);
    expect(await orgExists(slug)).toBe(false);
  });

  it('holds the name for the person who is registering it, and not for anyone else', async () => {
    const slug = newSlug();
    expect((await register(slug, 'first@example.com')).status).toBe(201);
    const rival = await register(slug, 'rival@example.com');
    expect(rival.status).toBe(409);
    // The rival cannot use the first person's code either.
    expect((await verify(slug, 'rival@example.com', lastCode('first@example.com'))).status).toBe(400);
    // Once the first person finishes, the name is taken for good.
    expect((await verify(slug, 'first@example.com', lastCode('first@example.com'))).status).toBe(201);
    expect((await register(slug, 'rival@example.com')).status).toBe(409);
  });

  it('a new code replaces the old one, with a one-minute wait and a limit of five', async () => {
    const slug = newSlug();
    const email = 'again@example.com';
    await register(slug, email);
    const first = lastCode(email);
    expect((await register(slug, email)).status).toBe(429); // too soon

    await skipCooldown(slug);
    expect((await http(app).post(`${API}/resend-registration-code`).send({ orgSlug: slug, email })).status).toBe(200);
    const second = lastCode(email);
    if (first !== second) expect((await verify(slug, email, first)).status).toBe(400); // the old code no longer works
    for (let i = 0; i < 3; i++) {
      await skipCooldown(slug);
      await http(app).post(`${API}/resend-registration-code`).send({ orgSlug: slug, email });
    }
    const before = sent.length;
    await skipCooldown(slug);
    await http(app).post(`${API}/resend-registration-code`).send({ orgSlug: slug, email }); // the sixth: silently nothing
    expect(sent.length).toBe(before);
  });

  it('resending says the same thing whether or not a sign-up exists', async () => {
    const known = newSlug();
    await register(known, 'known@example.com');
    await skipCooldown(known);
    const a = await http(app).post(`${API}/resend-registration-code`).send({ orgSlug: known, email: 'known@example.com' });
    const b = await http(app).post(`${API}/resend-registration-code`).send({ orgSlug: 'no-such-org', email: 'ghost@example.com' });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(b.body).toEqual(a.body);
  });

  it('an organisation name that already exists is refused before any email is sent', async () => {
    const slug = newSlug();
    await register(slug, 'taken@example.com');
    await verify(slug, 'taken@example.com', lastCode('taken@example.com'));
    const before = sent.length;
    expect((await register(slug, 'someone@example.com')).status).toBe(409);
    expect(sent.length).toBe(before);
  });

  it('says so when the email cannot be sent, instead of pretending', async () => {
    const mailer = app.get(MailerService);
    vi.spyOn(mailer, 'send').mockRejectedValueOnce(new Error('smtp down'));
    const slug = newSlug();
    const res = await register(slug, 'nomail@example.com');
    expect(res.status).toBe(503);
    expect(res.body.message).toMatch(/could not send/);
    expect(await orgExists(slug)).toBe(false);
  });

  it('can be switched off (REQUIRE_EMAIL_VERIFICATION=false) to create the organisation straight away', async () => {
    process.env.REQUIRE_EMAIL_VERIFICATION = 'false';
    const direct = await createTestApp();
    try {
      const slug = newSlug();
      const res = await http(direct).post(`${API}/register-org`).send({ orgName: 'Direct', orgSlug: slug, email: 'direct@example.com', password: PASSWORD });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ organization: { slug }, user: { role: 'ADMIN' } });
    } finally {
      await direct.close();
      process.env.REQUIRE_EMAIL_VERIFICATION = 'true';
    }
  });
});
