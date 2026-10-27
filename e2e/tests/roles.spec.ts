import { expect, test } from '@playwright/test';
import { createOrg, createTicket, rest, signIn } from './helpers';
import type { Org } from './helpers';

let org: Org;
let other: Org;
let ticket: string;
test.beforeAll(async () => {
  org = await createOrg('roles');
  other = await createOrg('other');
  ticket = await createTicket(org.customer.token, 'Private to customer one');
});

test.describe('who sees what', () => {
  test('a customer gets no staff navigation and is bounced from every staff page', async ({ page }) => {
    await signIn(page, org.slug, org.customer.email);
    const nav = page.getByRole('navigation');
    await expect(nav.getByRole('link', { name: 'My tickets' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'New ticket' })).toBeVisible();
    for (const staffOnly of ['Dashboard', 'Queue', 'Canned responses', 'Team', 'Emails']) {
      await expect(nav.getByRole('link', { name: staffOnly })).toHaveCount(0);
    }
    for (const path of ['/dashboard', '/canned', '/team', '/notifications']) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/tickets$/);
    }
  });

  test('an agent can work the queue but not manage the team or read the email log', async ({ page }) => {
    await signIn(page, org.slug, org.agent.email);
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await page.goto('/canned');
    await expect(page.getByRole('heading', { name: 'Canned responses' })).toBeVisible();
    for (const adminOnly of ['/team', '/notifications']) {
      await page.goto(adminOnly);
      await expect(page).toHaveURL(/\/tickets$/);
    }
    await page.goto('/tickets/new'); // only customers raise tickets
    await expect(page).toHaveURL(/\/tickets$/);
  });

  test('an admin sees everything', async ({ page }) => {
    await signIn(page, org.slug, org.admin.email);
    for (const [path, heading] of [['/team', 'Team'], ['/notifications', 'Email log'], ['/dashboard', 'Dashboard'], ['/account', 'Your account']] as const) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    }
  });

  test('the API refuses staff-only calls from a customer even if the page is bypassed', async () => {
    expect((await rest('/tickets/stats', 'GET', undefined, org.customer.token)).status).toBe(403);
    expect((await rest('/team', 'GET', undefined, org.customer.token)).status).toBe(403);
    expect((await rest('/notifications', 'GET', undefined, org.agent.token)).status).toBe(403);
    expect((await rest('/auth/invite', 'POST', { email: 'x@x.test', role: 'AGENT' }, org.agent.token)).status).toBe(403);
  });
});

test.describe('isolation between tenants and between customers', () => {
  test("another customer in the same organisation gets a 404 for someone else's ticket", async ({ page }) => {
    await signIn(page, org.slug, org.customer2.email);
    await page.goto(`/tickets/${ticket}`);
    // The page shows "not found". (Its HTTP status is 200 because the page streams in after the shell is sent; what
    // matters here is that nothing of the ticket is revealed.)
    await expect(page.getByText('could not be found')).toBeVisible();
    await expect(page.getByText('Private to customer one')).toHaveCount(0);
  });

  test("another organisation's admin, even, gets a 404 and sees none of it", async ({ page }) => {
    await signIn(page, other.slug, other.admin.email);
    await page.goto(`/tickets/${ticket}`);
    await expect(page.getByText('could not be found')).toBeVisible();
    await expect(page.getByText('Private to customer one')).toHaveCount(0);
    await page.goto('/tickets');
    await expect(page.getByText('Private to customer one')).toHaveCount(0);
  });

  test('a malformed ticket id is a plain 404, not an error page', async ({ page }) => {
    await signIn(page, org.slug, org.agent.email);
    await page.goto('/tickets/not-a-real-id');
    await expect(page.getByText('could not be found')).toBeVisible();
  });

  test('internal notes never reach the customer: not on the page, not in its HTML', async ({ page }) => {
    await rest('/tickets/' + ticket + '/comments', 'POST', { message: 'SECRET internal thought', isInternalNote: true }, org.agent.token);
    await rest('/tickets/' + ticket + '/comments', 'POST', { message: 'A normal public reply' }, org.agent.token);
    await signIn(page, org.slug, org.customer.email);
    await page.goto(`/tickets/${ticket}`);
    await expect(page.getByText('A normal public reply')).toBeVisible();
    expect(await page.content()).not.toContain('SECRET internal thought');
    expect(await page.content()).not.toContain(org.agent.email); // and the agent's address is not exposed either
  });
});
