import { expect, test } from '@playwright/test';
import { createOrg, createTicket, rest, signIn } from './helpers';
import type { Org } from './helpers';

let org: Org;
test.beforeAll(async () => {
  org = await createOrg('tickets');
});

test('a customer raises a ticket, sees it in their list, and can follow it', async ({ page }) => {
  await signIn(page, org.slug, org.customer.email);
  await expect(page.getByText('You have not raised any tickets yet.')).toBeVisible();
  await page.getByRole('link', { name: 'New ticket' }).first().click();
  await expect(page).toHaveURL(/\/tickets\/new$/);
  await expect(page.getByRole('heading', { name: 'New ticket' })).toBeVisible(); // the URL changes before the page content does
  await page.getByLabel('Subject', { exact: true }).fill('Printer on fire');
  await page.locator('select[name=priority]:visible').selectOption('HIGH');
  await page.getByRole('button', { name: 'Submit ticket' }).click();
  await expect(page).toHaveURL(/\/tickets\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'Printer on fire' })).toBeVisible();
  await expect(page.locator('span:text-is("HIGH")')).toBeVisible(); // the badge (not the options of a hidden select)
  await expect(page.locator('span:text-is("OPEN")')).toBeVisible();
  await expect(page.getByText('SLA deadline')).toHaveCount(0); // customers do not see internal SLA data
  await page.goto('/tickets');
  await expect(page.getByRole('link', { name: 'Printer on fire' })).toBeVisible();
});

test('blank and over-long subjects are rejected with a clear message', async ({ page }) => {
  await signIn(page, org.slug, org.customer.email);
  await page.goto('/tickets/new');
  await page.getByLabel('Subject', { exact: true }).fill('   ');
  await page.getByRole('button', { name: 'Submit ticket' }).click(); // the browser's own required-field check stops it
  await expect(page).toHaveURL(/\/tickets\/new/);
  expect((await rest('/tickets', 'POST', { subject: '   ' }, org.customer.token)).status).toBe(400); // and so does the API
  expect((await rest('/tickets', 'POST', { subject: 'x'.repeat(201) }, org.customer.token)).status).toBe(400);
});

test.describe('the agent queue', () => {
  test.beforeAll(async () => {
    for (const [subject, priority] of [['Login loop', 'LOW'], ['Invoice wrong', 'URGENT'], ['Cannot export', 'MEDIUM']] as const) {
      await createTicket(org.customer.token, subject, priority);
    }
  });

  test('filters by status, priority, text and assignee, and clears them', async ({ page }) => {
    await signIn(page, org.slug, org.agent.email);
    await page.goto('/tickets?priority=URGENT');
    await expect(page.getByRole('link', { name: 'Invoice wrong' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Login loop' })).toHaveCount(0);

    await page.goto('/tickets?q=export');
    await expect(page.getByRole('link', { name: 'Cannot export' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Invoice wrong' })).toHaveCount(0);

    await page.goto('/tickets?q=zzzzzz');
    await expect(page.getByText('No tickets match these filters.')).toBeVisible();
    await page.getByRole('link', { name: 'Clear' }).click();
    await expect(page.getByRole('link', { name: 'Invoice wrong' })).toBeVisible();

    await page.goto('/tickets?assigned=me');
    await expect(page.getByText('No tickets match these filters.')).toBeVisible();
    await page.goto('/tickets?status=NOPE&assigned=bob'); // hand-edited values are ignored, not an error
    await expect(page.getByRole('heading', { name: 'Ticket queue' })).toBeVisible();
  });

  test('assigning a ticket, changing its status and using a canned response all work from the ticket page', async ({ page, browser }) => {
    const id = await createTicket(org.customer.token, 'Needs the full treatment');
    await rest('/canned-responses', 'POST', { title: 'Thanks', body: 'Thanks for getting in touch.' }, org.agent.token);

    await signIn(page, org.slug, org.agent.email);
    await page.goto(`/tickets/${id}`);
    await expect(page.getByTestId('assignee')).toContainText('nobody');
    await page.getByLabel('Assignee').selectOption({ label: `${org.agent.email} (me)` });
    await page.getByRole('button', { name: 'Assign' }).click();
    await expect(page.getByTestId('assignee')).toContainText(org.agent.email);

    await page.getByLabel('Status').selectOption('RESOLVED');
    await page.getByRole('button', { name: 'Update status' }).click();
    await expect(page.getByText('Status updated.')).toBeVisible();
    await expect(page.getByLabel('Status')).toHaveValue('RESOLVED');

    await page.getByLabel('Insert a canned response').selectOption({ label: 'Thanks' });
    await expect(page.getByLabel('Message')).toHaveValue('Thanks for getting in touch.');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByText('Reply sent.')).toBeVisible();
    await expect(page.getByText('Thanks for getting in touch.').first()).toBeVisible();

    const customerContext = await browser.newContext();
    const customer = await customerContext.newPage();
    await signIn(customer, org.slug, org.customer.email);
    await customer.goto(`/tickets/${id}`);
    await expect(customer.getByText('Thanks for getting in touch.')).toBeVisible();
    await expect(customer.getByText('RESOLVED', { exact: true })).toBeVisible();
    await expect(customer.getByLabel('Insert a canned response')).toHaveCount(0); // staff only
    await expect(customer.getByTestId('assignee')).toHaveCount(0);
    await customerContext.close();
  });

  test('pages through more than one page of tickets', async ({ page }) => {
    const paged = await createOrg('paged');
    for (let i = 1; i <= 22; i++) await createTicket(paged.customer.token, `Bulk ticket ${i}`);
    await signIn(page, paged.slug, paged.agent.email);
    await expect(page.getByText('22 tickets · page 1 of 2')).toBeVisible();
    await page.getByRole('link', { name: 'Next →' }).click();
    await expect(page.getByText('page 2 of 2')).toBeVisible();
    await expect(page.getByRole('link', { name: /Bulk ticket/ })).toHaveCount(2);
    await page.getByRole('link', { name: '← Previous' }).click();
    await expect(page.getByText('page 1 of 2')).toBeVisible();
  });

  test('the dashboard counts are right and link to the matching filtered queue', async ({ page }) => {
    const fresh = await createOrg('dash');
    await createTicket(fresh.customer.token, 'Dash one', 'HIGH');
    await createTicket(fresh.customer.token, 'Dash two', 'MEDIUM');
    await signIn(page, fresh.slug, fresh.agent.email);
    await page.goto('/dashboard');
    await expect(page.getByRole('link', { name: /open 2/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /unassigned \(active\) 2/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /high 1/i })).toBeVisible();
    await page.getByRole('link', { name: /unassigned \(active\) 2/i }).click();
    await expect(page).toHaveURL(/assigned=unassigned/);
    await expect(page.getByRole('link', { name: 'Dash one' })).toBeVisible();
  });
});

test('canned responses can be created, listed and deleted by staff', async ({ page }) => {
  await signIn(page, org.slug, org.agent.email);
  await page.goto('/canned');
  await page.getByLabel('Title').fill('Greeting');
  await page.getByLabel('Text').fill('Hello, thanks for contacting us.');
  await page.getByRole('button', { name: 'Save canned response' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await expect(page.getByText('Hello, thanks for contacting us.')).toBeVisible();
  await page.getByRole('button', { name: 'Delete Greeting' }).click();
  await expect(page.getByText('Hello, thanks for contacting us.')).toHaveCount(0);
});
