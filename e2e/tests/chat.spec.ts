import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { createOrg, createTicket, signIn } from './helpers';
import type { Org } from './helpers';

let org: Org;
let ticket: string;
test.beforeAll(async () => {
  org = await createOrg('chat');
  ticket = await createTicket(org.customer.token, 'Live conversation', 'HIGH');
});

const send = async (page: Page, message: string, internal = false) => {
  await page.getByLabel('Message').fill(message);
  if (internal) await page.getByLabel('Internal note (the customer cannot see it)').check();
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText(internal ? 'Internal note added.' : 'Reply sent.')).toBeVisible();
  if (internal) await page.getByLabel('Internal note (the customer cannot see it)').uncheck();
};

test('a customer and an agent chat live, with no reloads, and internal notes stay private', async ({ browser }) => {
  const customerContext = await browser.newContext();
  const agentContext = await browser.newContext();
  const customer = await customerContext.newPage();
  const agent = await agentContext.newPage();
  await signIn(customer, org.slug, org.customer.email);
  await signIn(agent, org.slug, org.agent.email);
  await customer.goto(`/tickets/${ticket}`);
  await agent.goto(`/tickets/${ticket}`);
  await expect(customer.getByText('Live', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(agent.getByText('Live', { exact: true })).toBeVisible({ timeout: 15_000 });
  await customer.evaluate(() => ((window as unknown as { __doc: string }).__doc = 'same'));
  await agent.evaluate(() => ((window as unknown as { __doc: string }).__doc = 'same'));

  await send(customer, 'Hello from the customer');
  await expect(agent.getByText('Hello from the customer')).toBeVisible();
  await expect(agent.getByText(org.customer.email).first()).toBeVisible(); // staff see who wrote it

  await send(agent, 'Hello from the agent');
  await expect(customer.getByText('Hello from the agent')).toBeVisible();
  await expect(customer.getByText('Support', { exact: true }).first()).toBeVisible(); // the customer sees a role, not an address
  expect(await customer.content()).not.toContain(org.agent.email);
  await expect(agent.getByText('Hello from the agent')).toHaveCount(1); // shown once, not once per delivery route

  await send(agent, 'SECRET internal note', true);
  await expect(agent.getByText('SECRET internal note')).toBeVisible();
  await expect(agent.getByText('Internal note', { exact: true })).toBeVisible();
  await customer.waitForTimeout(1500);
  await expect(customer.getByText('SECRET internal note')).toHaveCount(0);
  expect(await customer.content()).not.toContain('SECRET internal note');

  // nothing reloaded: both pages are still the same document
  expect(await customer.evaluate(() => (window as unknown as { __doc: string }).__doc)).toBe('same');
  expect(await agent.evaluate(() => (window as unknown as { __doc: string }).__doc)).toBe('same');
  await customerContext.close();
  await agentContext.close();
});

test('typing indicators and status changes arrive live; typing an internal note is invisible to the customer', async ({ browser }) => {
  const customerContext = await browser.newContext();
  const agentContext = await browser.newContext();
  const customer = await customerContext.newPage();
  const agent = await agentContext.newPage();
  await signIn(customer, org.slug, org.customer.email);
  await signIn(agent, org.slug, org.agent.email);
  await customer.goto(`/tickets/${ticket}`);
  await agent.goto(`/tickets/${ticket}`);
  await expect(customer.getByText('Live', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(agent.getByText('Live', { exact: true })).toBeVisible({ timeout: 15_000 });

  await customer.getByLabel('Message').pressSequentially('typing something', { delay: 20 });
  await expect(agent.getByTestId('typing')).toContainText('Customer is typing');
  await expect(agent.getByTestId('typing')).toHaveText('', { timeout: 10_000 }); // stops by itself
  await customer.getByLabel('Message').fill('');

  await agent.getByLabel('Message').pressSequentially('agent typing', { delay: 20 });
  await expect(customer.getByTestId('typing')).toContainText('Support is typing');
  await agent.getByLabel('Message').fill('');
  await expect(customer.getByTestId('typing')).toHaveText('', { timeout: 10_000 });

  await agent.getByLabel('Internal note (the customer cannot see it)').check();
  await agent.getByLabel('Message').pressSequentially('secret thoughts', { delay: 20 });
  await customer.waitForTimeout(1500);
  await expect(customer.getByTestId('typing')).toHaveText('');
  await agent.getByLabel('Message').fill('');
  await agent.getByLabel('Internal note (the customer cannot see it)').uncheck();

  await agent.getByLabel('Status').selectOption('IN_PROGRESS');
  await agent.getByRole('button', { name: 'Update status' }).click();
  await expect(customer.getByText('IN PROGRESS', { exact: true })).toBeVisible();
  await expect(agent.getByLabel('Status')).toHaveValue('IN_PROGRESS'); // the selector keeps the new value after saving
  await expect(agent.getByText('Status updated.')).toBeVisible();
  await customerContext.close();
  await agentContext.close();
});
