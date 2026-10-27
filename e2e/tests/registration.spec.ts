import { expect, test } from '@playwright/test';
import { now, PASSWORD, trackOrg, verificationCode } from './helpers';

test('signing up needs the emailed code: wrong code refused, right code creates the organisation, then sign in', async ({ page }) => {
  const slug = `otp-${Math.random().toString(16).slice(2, 8)}`;
  const email = `owner@${slug}.test`;
  trackOrg(slug);
  const since = now();

  await page.goto('/register');
  await page.getByLabel('Organisation name').fill('E2E otp');
  await page.getByLabel(/Organisation slug/).fill(slug);
  await page.getByLabel('Admin email').fill(email);
  await page.getByLabel(/^Password/).fill(PASSWORD);
  await page.getByRole('button', { name: 'Create organisation' }).click();

  await expect(page).toHaveURL(/\/verify-email\?/);
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();

  // Not signed in and nothing exists yet: the password does not work.
  const code = await verificationCode(email, since);
  const wrong = code === '000000' ? '111111' : '000000';
  await page.getByLabel('Verification code').fill(wrong);
  await page.getByRole('button', { name: 'Verify and create organisation' }).click();
  await expect(page.getByText('This code is invalid or has expired.')).toBeVisible();

  // Asking for another code straight away is refused politely (one a minute).
  await page.getByRole('button', { name: 'Send a new code' }).click();
  await expect(page.getByText('Please wait a minute before asking for another code.')).toBeVisible();

  await page.getByLabel('Verification code').fill(code);
  await page.getByRole('button', { name: 'Verify and create organisation' }).click();
  await expect(page).toHaveURL(/\/login\?verified=1/);
  await expect(page.getByText('Email verified and your organisation is ready.')).toBeVisible();

  await page.getByLabel('Organisation (slug)').fill(slug);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/tickets');
});

test('the verify page with nothing to verify points back to sign-up', async ({ page }) => {
  await page.goto('/verify-email');
  await expect(page.getByText('Nothing to verify here.')).toBeVisible();
  await page.getByRole('link', { name: 'Start again' }).click();
  await expect(page).toHaveURL(/\/register$/);
});
