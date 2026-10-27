import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';

export const API = process.env.E2E_API_URL ?? 'http://localhost:4310/api/v1';
export const MAIL = process.env.E2E_MAIL_URL ?? 'http://localhost:4026';
export const PASSWORD = 'Welcome123';

export async function rest<T = Record<string, unknown>>(
  path: string,
  method: string,
  body?: unknown,
  token?: string,
): Promise<{ status: number; body: T }> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as T };
}

export interface Person {
  email: string;
  token: string;
}
export interface Org {
  slug: string;
  admin: Person;
  agent: Person;
  customer: Person;
  customer2: Person;
}

const unique = () => Math.random().toString(16).slice(2, 8);

/** Remembers an organisation a test created, so the cleanup after the run removes it. */
export function trackOrg(slug: string) {
  appendFileSync(path.resolve(import.meta.dirname, '..', '.created-orgs.txt'), `${slug}
`);
}

/** The 6-digit sign-up code emailed to `to` since `since`. */
export async function verificationCode(to: string, since: number): Promise<string> {
  const mail = await waitForMail(to, 'verification code', since);
  return /\b(\d{6})\b/.exec(mail)![1];
}

/** A brand-new organisation with an admin, an agent and two customers. Every test file makes its own. */
export async function createOrg(label: string): Promise<Org> {
  const slug = `${label}-${unique()}`;
  trackOrg(slug);
  const email = (name: string) => `${name}@${slug}.test`;
  const since = now();
  const reg = await rest('/auth/register-org', 'POST', { orgName: `E2E ${label}`, orgSlug: slug, email: email('admin'), password: PASSWORD });
  if (reg.status !== 201) throw new Error(`register-org failed: ${reg.status} ${JSON.stringify(reg.body)}`);
  // Sign-up is verified by an emailed code: read it from the dev mail inbox (Mailpit), exactly as a person would.
  const code = await verificationCode(email('admin'), since);
  const verified = await rest('/auth/verify-registration', 'POST', { orgSlug: slug, email: email('admin'), code });
  if (verified.status !== 201) throw new Error(`verify-registration failed: ${verified.status} ${JSON.stringify(verified.body)}`);
  const loginAs = async (name: string): Promise<Person> => {
    const res = await rest<{ accessToken: string }>('/auth/login', 'POST', { orgSlug: slug, email: email(name), password: PASSWORD });
    if (res.status !== 200) throw new Error(`login ${name} failed: ${res.status}`);
    return { email: email(name), token: res.body.accessToken };
  };
  const admin = await loginAs('admin');
  for (const [name, role] of [['agent', 'AGENT'], ['customer', 'CUSTOMER'], ['customer2', 'CUSTOMER']] as const) {
    const res = await rest('/auth/invite', 'POST', { email: email(name), password: PASSWORD, role }, admin.token);
    if (res.status !== 201) throw new Error(`invite ${name} failed: ${res.status}`);
  }
  return { slug, admin, agent: await loginAs('agent'), customer: await loginAs('customer'), customer2: await loginAs('customer2') };
}

export async function createTicket(token: string, subject: string, priority = 'MEDIUM') {
  const res = await rest<{ id: string }>('/tickets', 'POST', { subject, priority }, token);
  expect(res.status).toBe(201);
  return res.body.id;
}

/** Signs in through the real login form. */
export async function signIn(page: Page, slug: string, email: string, password = PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('Organisation (slug)').fill(slug);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/tickets');
}

export async function cookie(context: BrowserContext, name: string) {
  return (await context.cookies()).find((c) => c.name === name);
}

/** The first email to `to` whose subject contains `subject` and which arrived after `since`. Polls until it shows up. */
export async function waitForMail(to: string, subject: string, since: number): Promise<string> {
  let text = '';
  await expect
    .poll(
      async () => {
        const { messages } = (await (await fetch(`${MAIL}/api/v1/messages?limit=200`)).json()) as {
          messages: { ID: string; Subject: string; Created: string; To: { Address: string }[] }[];
        };
        const found = messages.find((m) => m.Subject.includes(subject) && m.To.some((t) => t.Address === to) && Date.parse(m.Created) >= since);
        if (!found) return false;
        text = ((await (await fetch(`${MAIL}/api/v1/message/${found.ID}`)).json()) as { Text: string }).Text;
        return true;
      },
      { message: `an email "${subject}" to ${to}`, timeout: 25_000 },
    )
    .toBe(true);
  return text;
}

/** The link in an email as a path and query on the web app (so the test works against any host). */
export function linkIn(mail: string) {
  const url = new URL(/(https?:\/\/\S+)/.exec(mail)![1]);
  return `${url.pathname}${url.search}`;
}

export const now = () => Date.now() - 2000;

/** An extra user in an existing organisation, so a test that changes a person never disturbs another test. */
export async function addUser(org: Org, role: 'AGENT' | 'CUSTOMER', password = PASSWORD): Promise<Person> {
  const email = `${role.toLowerCase()}-${unique()}@${org.slug}.test`;
  const res = await rest('/auth/invite', 'POST', { email, password, role }, org.admin.token);
  if (res.status !== 201) throw new Error(`invite failed: ${res.status}`);
  const login = await rest<{ accessToken: string }>('/auth/login', 'POST', { orgSlug: org.slug, email, password });
  return { email, token: login.body.accessToken };
}

// ---- helpers that reach into the running Docker stack (SLA timers, restarts). Tests that use them skip without docker. ----
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const rootEnv = () => {
  try {
    return readFileSync(path.resolve(import.meta.dirname, '..', '..', '.env'), 'utf8');
  } catch {
    return '';
  }
};
const fromEnv = (name: string) => new RegExp(`^${name}=(.*)$`, 'm').exec(rootEnv())?.[1]?.trim();

export const dockerAvailable = () => {
  try {
    execFileSync('docker', ['exec', 'helpdesk-redis', 'true'], { stdio: 'ignore' });
    return Boolean(fromEnv('REDIS_PASSWORD') && fromEnv('POSTGRES_USER'));
  } catch {
    return false;
  }
};

export const psql = (sql: string) =>
  execFileSync('docker', ['exec', 'helpdesk-postgres', 'psql', '-U', fromEnv('POSTGRES_USER')!, '-d', fromEnv('POSTGRES_DB')!, '-tAc', sql], { encoding: 'utf8' }).trim();

export const redisCli = (...args: string[]) =>
  execFileSync('docker', ['exec', 'helpdesk-redis', 'redis-cli', '-a', fromEnv('REDIS_PASSWORD')!, '--no-auth-warning', ...args], { encoding: 'utf8' }).trim();

/** True when the API is running as the Docker container (and so can be restarted by a test). */
export const backendInDocker = () => {
  try {
    return execFileSync('docker', ['inspect', '-f', '{{.State.Running}}', 'helpdesk-backend'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() === 'true';
  } catch {
    return false;
  }
};

/**
 * Opens a page that is expected to redirect (to /login). The Next.js dev server sometimes cancels the first navigation
 * of such a redirect (net::ERR_ABORTED) while it follows it in the browser; the production build does not. The test
 * then asserts where the page ended up, so tolerating the cancelled first request hides nothing.
 */
export async function visit(page: Page, url: string) {
  await page.goto(url).catch((error: Error) => {
    if (!/ERR_ABORTED/.test(error.message)) throw error;
  });
}

export const docker = (...args: string[]) => execFileSync('docker', args, { encoding: 'utf8' }).trim();
