import { expect, test } from '@playwright/test';
import { createOrg, createTicket, rest, signIn } from './helpers';
import type { Org } from './helpers';

// Needs a super admin that exists in the stack's database (created with `npm run platform:create-admin`).
// Without E2E_PLATFORM_EMAIL and E2E_PLATFORM_PASSWORD these tests are skipped.
const EMAIL = process.env.E2E_PLATFORM_EMAIL;
const PASSWORD = process.env.E2E_PLATFORM_PASSWORD;
test.skip(!EMAIL || !PASSWORD, 'set E2E_PLATFORM_EMAIL and E2E_PLATFORM_PASSWORD to run the platform console tests');

let org: Org;
let ticket: string;
test.beforeAll(async () => {
  org = await createOrg('plat');
  ticket = await createTicket(org.customer.token, 'Visible to the platform admin');
  await rest(`/tickets/${ticket}/comments`, 'POST', { message: 'Internal: staff only note', isInternalNote: true }, org.agent.token);
});

async function platformSignIn(page: import('@playwright/test').Page) {
  await page.goto('/platform/login');
  await page.getByLabel('Email').fill(EMAIL!);
  await page.getByLabel('Password').fill(PASSWORD!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/platform');
}

test('a wrong password is refused and the console needs a login', async ({ page }) => {
  await page.goto('/platform/organizations');
  await expect(page).toHaveURL(/\/platform\/login$/);
  await page.getByLabel('Email').fill(EMAIL!);
  await page.getByLabel('Password').fill('definitely-not-it');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Invalid credentials')).toBeVisible();
});

test('the super admin finds an organisation, reads a ticket with its internal note, and edits the plan', async ({ page }) => {
  await platformSignIn(page);
  await expect(page.getByRole('heading', { name: 'Platform overview' })).toBeVisible();
  await page.getByRole('navigation').getByRole('link', { name: 'Organisations' }).click();
  await page.getByLabel('Search organisations').fill(org.slug);
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('link', { name: 'E2E plat' }).click();
  await expect(page.getByRole('heading', { name: 'People (4)' })).toBeVisible();

  await page.getByLabel('Plan').selectOption('PRO');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();

  await page.getByRole('link', { name: 'Visible to the platform admin' }).click();
  await expect(page.getByText('Internal: staff only note')).toBeVisible();
  await expect(page.getByText('This view has been recorded')).toBeVisible();

  await page.getByRole('navigation').getByRole('link', { name: 'Audit log' }).click();
  await expect(page.getByRole('cell', { name: 'TICKET_VIEWED' }).first()).toBeVisible();
  await expect(page.getByRole('cell', { name: 'ORG_UPDATED' }).first()).toBeVisible();
});

test('suspending an organisation signs its people out and blocks sign-in until it is reactivated', async ({ page, browser }) => {
  const tenant = await browser.newContext();
  const tenantPage = await tenant.newPage();
  await signIn(tenantPage, org.slug, org.customer.email);

  await platformSignIn(page);
  await page.goto('/platform/organizations');
  await page.getByLabel('Search organisations').fill(org.slug);
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('link', { name: 'E2E plat' }).click();
  await page.getByLabel('Reason for suspending').fill('Unpaid invoice');
  await page.getByRole('button', { name: 'Suspend organisation' }).click();
  await expect(page.getByText('Suspended: Unpaid invoice')).toBeVisible();

  // The customer's open session is over, and signing in again says why.
  await tenantPage.goto('/tickets');
  await expect(tenantPage).toHaveURL(/\/login/);
  await tenantPage.getByLabel('Organisation (slug)').fill(org.slug);
  await tenantPage.getByLabel('Email').fill(org.customer.email);
  await tenantPage.getByLabel('Password').fill('Welcome123');
  await tenantPage.getByRole('button', { name: 'Sign in' }).click();
  await expect(tenantPage.getByText(/organisation has been suspended/)).toBeVisible();

  await page.getByRole('button', { name: 'Reactivate organisation' }).click();
  await expect(page.getByText('Organisation reactivated.')).toBeVisible();
  await tenantPage.getByLabel('Password').fill('Welcome123'); // the form clears the password after a failure
  await tenantPage.getByRole('button', { name: 'Sign in' }).click();
  await tenantPage.waitForURL('**/tickets');
  await tenant.close();
});

test('the two logins are separate worlds', async ({ page, browser }) => {
  // A tenant admin has no way into the console...
  const tenant = await browser.newContext();
  const tenantPage = await tenant.newPage();
  await signIn(tenantPage, org.slug, org.admin.email);
  await tenantPage.goto('/platform/organizations');
  await expect(tenantPage).toHaveURL(/\/platform\/login$/);
  await tenant.close();

  // ...and the super admin is not signed in to any organisation.
  await platformSignIn(page);
  await page.goto('/tickets');
  await expect(page).toHaveURL(/\/login/);
});
