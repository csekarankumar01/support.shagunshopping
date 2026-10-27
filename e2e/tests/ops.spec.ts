import { expect, test } from '@playwright/test';
import { createOrg, createTicket, dockerAvailable, docker, now, psql, redisCli, rest, signIn, waitForMail } from './helpers';
import type { Org } from './helpers';

// These tests reach into the running Docker stack (Postgres, Redis, the API container). They are skipped without it.
test.skip(!dockerAvailable(), 'needs the docker CLI and the stack from docker-compose.yml');

let org: Org;
test.beforeAll(async () => {
  org = await createOrg('ops');
});

test('creating a ticket sends a receipt through the outbox, Kafka and SMTP; the admin sees it in the email log', async ({ page, browser }) => {
  const since = now();
  await signIn(page, org.slug, org.customer.email);
  await page.goto('/tickets/new');
  await page.getByLabel('Subject', { exact: true }).fill('Receipt please');
  await page.getByRole('button', { name: 'Submit ticket' }).click();
  await expect(page).toHaveURL(/\/tickets\/[0-9a-f-]{36}$/);
  const mail = await waitForMail(org.customer.email, 'We received your request', since);
  expect(mail).toContain('Receipt please');

  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  await signIn(admin, org.slug, org.admin.email);
  await admin.goto('/notifications');
  await expect(admin.getByRole('row', { name: /Receipt to customer.*SENT/ })).toBeVisible({ timeout: 20_000 });
  await adminContext.close();
});

test('a new ticket appears in the agent queue by itself, with a pop-up', async ({ browser }) => {
  const agentContext = await browser.newContext();
  const agent = await agentContext.newPage();
  await signIn(agent, org.slug, org.agent.email);
  await agent.goto('/tickets');
  await expect(agent.getByTestId('online-staff')).toContainText(org.agent.email, { timeout: 15_000 });
  await createTicket(org.customer.token, 'Appears live');
  await expect(agent.getByRole('link', { name: 'Appears live' })).toBeVisible({ timeout: 20_000 });
  await expect(agent.getByTestId('toasts')).toContainText('New ticket');
  await agentContext.close();
});

test('a missed SLA is flagged, escalated, announced live and emailed to the supervisor', async ({ browser }) => {
  const subject = `Overdue ${Date.now()}`;
  const id = await createTicket(org.customer.token, subject, 'MEDIUM');
  const orgId = psql(`select id from organizations where slug='${org.slug}'`);
  const member = `${orgId}:${id}`;
  await expect.poll(() => redisCli('ZSCORE', 'sla:active_timers', member), { timeout: 20_000 }).not.toBe(''); // the Kafka consumer registered it

  const agentContext = await browser.newContext();
  const agent = await agentContext.newPage();
  await signIn(agent, org.slug, org.agent.email);
  await agent.goto('/tickets');
  await expect(agent.getByTestId('online-staff')).toContainText(org.agent.email, { timeout: 15_000 });

  const since = now();
  // Make it overdue the way time would: the deadline passes in the database and in Redis.
  psql(`update tickets set sla_deadline = now() - interval '1 second' where id = '${id}'`);
  redisCli('ZADD', 'sla:active_timers', String(Date.now() - 1000), member);

  await expect(agent.getByTestId('toasts')).toContainText('SLA breached', { timeout: 30_000 });
  expect(psql(`select priority || '/' || (sla_breached_at is not null) from tickets where id = '${id}'`)).toBe('HIGH/true'); // MEDIUM raised one level
  expect(redisCli('ZSCORE', 'sla:active_timers', member)).toBe(''); // the timer is done
  await agent.goto(`/tickets/${id}`);
  await expect(agent.getByTestId('sla-breached')).toBeVisible();
  await agent.goto('/tickets?breached=true');
  await expect(agent.getByRole('link', { name: subject })).toBeVisible();

  await waitForMail(org.admin.email, `SLA breached: ${subject}`, since);
  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  await signIn(admin, org.slug, org.admin.email);
  await admin.goto('/notifications');
  await expect(admin.getByRole('row', { name: /SLA breach alert/ }).first()).toBeVisible();
  await agentContext.close();
  await adminContext.close();
});

test('a public staff reply stops the SLA clock', async () => {
  const id = await createTicket(org.customer.token, 'Answered in time');
  const orgId = psql(`select id from organizations where slug='${org.slug}'`);
  const member = `${orgId}:${id}`;
  await expect.poll(() => redisCli('ZSCORE', 'sla:active_timers', member), { timeout: 20_000 }).not.toBe('');
  expect((await rest(`/tickets/${id}/comments`, 'POST', { message: 'On it' }, org.agent.token)).status).toBe(201);
  expect(redisCli('ZSCORE', 'sla:active_timers', member)).toBe('');
});

test('the page reconnects by itself after the API restarts and keeps receiving messages', async ({ browser }) => {
  const id = await createTicket(org.customer.token, 'Restart me');
  const context = await browser.newContext();
  const customer = await context.newPage();
  await signIn(customer, org.slug, org.customer.email);
  await customer.goto(`/tickets/${id}`);
  await expect(customer.getByText('Live', { exact: true })).toBeVisible({ timeout: 15_000 });

  docker('restart', '-t', '2', 'helpdesk-backend');
  await expect(customer.getByText('Reconnecting…')).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => (await fetch(`${process.env.E2E_API_URL ?? 'http://localhost:4310/api/v1'}/health`).catch(() => null))?.status, { timeout: 60_000 }).toBe(200);
  await expect(customer.getByText('Live', { exact: true })).toBeVisible({ timeout: 40_000 });

  const login = await rest<{ accessToken: string }>('/auth/login', 'POST', { orgSlug: org.slug, email: org.agent.email, password: 'Welcome123' });
  await rest(`/tickets/${id}/comments`, 'POST', { message: 'Sent after the restart' }, login.body.accessToken);
  await expect(customer.getByText('Sent after the restart')).toBeVisible({ timeout: 15_000 });
  await context.close();
});
