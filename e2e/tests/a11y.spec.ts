import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { createOrg, createTicket, rest, signIn } from './helpers';
import type { Org } from './helpers';

// Automated accessibility checks (WCAG 2.0/2.1 levels A and AA, including colour contrast) on every kind of page, in
// both colour schemes. Automated tools catch roughly a third of accessibility problems: this is a safety net against
// regressions, not a certificate. Keyboard-only use and screen-reader behaviour still need a person.
let org: Org;
let ticket: string;
test.beforeAll(async () => {
  org = await createOrg('a11y');
  ticket = await createTicket(org.customer.token, 'Accessibility check', 'HIGH');
  await rest(`/tickets/${ticket}/comments`, 'POST', { message: 'A reply to read' }, org.agent.token);
  await rest(`/tickets/${ticket}/comments`, 'POST', { message: 'A private note', isInternalNote: true }, org.agent.token);
  await rest('/canned-responses', 'POST', { title: 'Saved reply', body: 'Some saved text' }, org.agent.token);
});

async function scan(page: Page, label: string) {
  await page.waitForLoadState('networkidle');
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const summary = violations.map((v) => `${v.id} (${v.impact}): ${v.help}\n    ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join('\n    ')}`);
  expect.soft(summary, `${label}: accessibility violations`).toEqual([]); // soft: report every page, not only the first failure
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`${scheme} colour scheme`, () => {
    test.use({ colorScheme: scheme });

    test('public pages', async ({ page }) => {
      for (const path of ['/login', '/register', '/forgot-password', '/reset-password?token=abc']) {
        await page.goto(path);
        await scan(page, path);
      }
    });

    test('customer pages', async ({ page }) => {
      await signIn(page, org.slug, org.customer.email);
      await scan(page, 'customer ticket list');
      await page.goto('/tickets/new');
      await scan(page, 'new ticket');
      await page.goto(`/tickets/${ticket}`);
      await expect(page.getByText('A reply to read')).toBeVisible();
      await scan(page, 'customer ticket page');
      await page.goto('/account');
      await scan(page, 'account');
    });

    test('agent pages', async ({ page }) => {
      await signIn(page, org.slug, org.agent.email);
      await scan(page, 'agent queue');
      await page.goto('/tickets?priority=HIGH&q=access');
      await scan(page, 'filtered queue');
      await page.goto(`/tickets/${ticket}`);
      await expect(page.getByText('A private note')).toBeVisible();
      await scan(page, 'agent ticket page');
      await page.goto('/dashboard');
      await scan(page, 'dashboard');
      await page.goto('/canned');
      await scan(page, 'canned responses');
    });

    test('admin pages', async ({ page }) => {
      await signIn(page, org.slug, org.admin.email);
      await page.goto('/team');
      await expect(page.getByText(org.agent.email)).toBeVisible();
      await scan(page, 'team');
      await page.goto('/notifications');
      await scan(page, 'email log');
    });

    test('the not-found page', async ({ page }) => {
      await signIn(page, org.slug, org.agent.email);
      await page.goto('/tickets/not-a-real-id');
      await expect(page.getByText('could not be found')).toBeVisible();
      await scan(page, 'not found');
    });
  });
}

test('everything can be reached and used with the keyboard alone (login form)', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Organisation (slug)').focus();
  await page.keyboard.type(org.slug);
  await page.keyboard.press('Tab');
  await page.keyboard.type(org.customer.email);
  await page.keyboard.press('Tab');
  await page.keyboard.type('Welcome123');
  await page.keyboard.press('Enter'); // submits from the password field
  await expect(page).toHaveURL(/\/tickets$/);
});
