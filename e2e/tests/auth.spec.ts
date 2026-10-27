import { expect, test } from '@playwright/test';
import { addUser, API, cookie, createOrg, linkIn, now, PASSWORD, rest, signIn, visit, waitForMail } from './helpers';
import type { Org } from './helpers';

let org: Org;
test.beforeAll(async () => {
  org = await createOrg('auth');
});

const tokensOf = async (context: import('@playwright/test').BrowserContext) => ({
  access: (await cookie(context, 'helpdesk_token'))!.value,
  refresh: (await cookie(context, 'helpdesk_refresh'))!.value,
});

test.describe('sessions', () => {
  test('login sets two httpOnly cookies and page JavaScript cannot read them', async ({ page, context }) => {
    const user = await addUser(org, 'AGENT');
    await signIn(page, org.slug, user.email);
    const access = await cookie(context, 'helpdesk_token');
    const refresh = await cookie(context, 'helpdesk_refresh');
    expect(access?.httpOnly).toBe(true);
    expect(refresh?.httpOnly).toBe(true);
    expect(access!.expires - Date.now() / 1000).toBeGreaterThan(800); // about 15 minutes
    expect(access!.expires - Date.now() / 1000).toBeLessThan(920);
    expect(refresh!.expires - Date.now() / 1000).toBeGreaterThan(13 * 86400); // about 14 days
    expect(await page.evaluate(() => document.cookie)).not.toContain('helpdesk');
  });

  test('renews itself when the access cookie is missing or corrupted, and rotates the refresh token', async ({ page, context }) => {
    const user = await addUser(org, 'AGENT');
    await signIn(page, org.slug, user.email);
    const before = await tokensOf(context);

    await context.clearCookies({ name: 'helpdesk_token' });
    await visit(page, '/tickets');
    await expect(page.getByRole('heading', { name: 'Ticket queue' })).toBeVisible();
    const after = await tokensOf(context);
    expect(after.refresh).not.toBe(before.refresh); // rotated (the access token can match if issued in the same second)

    await context.addCookies([{ name: 'helpdesk_token', value: 'garbage.not.ajwt', url: page.url(), httpOnly: true, sameSite: 'Lax' }]);
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });

  test('logging out ends the session on the server, not only in the browser', async ({ page, context }) => {
    const user = await addUser(org, 'AGENT');
    await signIn(page, org.slug, user.email);
    const { access, refresh } = await tokensOf(context);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);
    expect(await cookie(context, 'helpdesk_token')).toBeUndefined();
    await expect.poll(() => cookie(context, 'helpdesk_refresh')).toBeUndefined();
    expect((await rest('/auth/refresh', 'POST', { refreshToken: refresh })).status).toBe(401);
    expect((await rest('/auth/me', 'GET', undefined, access)).status).toBe(401); // still "valid" for minutes, but revoked
  });

  test('a session revoked elsewhere cannot be renewed: back to login with a notice', async ({ page, context }) => {
    const user = await addUser(org, 'AGENT');
    await signIn(page, org.slug, user.email);
    const { refresh } = await tokensOf(context);
    await rest('/auth/logout', 'POST', { refreshToken: refresh }); // e.g. signed out from another device
    await context.clearCookies({ name: 'helpdesk_token' });
    await visit(page, '/tickets');
    await expect(page).toHaveURL(/\/login\?expired=1/);
    await expect(page.getByText('Your session has ended')).toBeVisible();
    await expect.poll(() => cookie(context, 'helpdesk_refresh')).toBeUndefined();
  });

  test('forged cookies are rejected', async ({ page, context }) => {
    await page.goto('/login');
    await context.addCookies([
      { name: 'helpdesk_token', value: 'forged.token.value', url: page.url(), httpOnly: true, sameSite: 'Lax' },
      { name: 'helpdesk_refresh', value: 'forged', url: page.url(), httpOnly: true, sameSite: 'Lax' },
    ]);
    await visit(page, '/tickets');
    await expect(page).toHaveURL(/\/login\?expired=1/);
  });

  test('wrong passwords get one neutral message, then are slowed down', async ({ page }) => {
    const victim = await addUser(org, 'CUSTOMER');
    const tryLogin = async () => {
      await page.getByLabel('Organisation (slug)').fill(org.slug);
      await page.getByLabel('Email').fill(victim.email);
      await page.getByLabel('Password', { exact: true }).fill('wrong-password');
      await page.getByRole('button', { name: 'Sign in' }).click();
    };
    await page.goto('/login');
    await tryLogin();
    await expect(page.getByText('Invalid credentials')).toBeVisible(); // one neutral message, no hint what was wrong

    // More wrong guesses (the API counts per account, 10 a minute; creating the user and the first try used two), made directly so the test does not race the form.
    for (let attempt = 2; attempt <= 9; attempt++) {
      expect((await rest('/auth/login', 'POST', { orgSlug: org.slug, email: victim.email, password: `wrong-${attempt}` })).status).toBe(401);
    }
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled();
    await tryLogin();
    await expect(page.getByText('Too many requests')).toBeVisible();
    await signIn(page, org.slug, org.customer.email); // a different account is unaffected
  });
});

test.describe('passwords', () => {
  test('forgot password: neutral answer, emailed single-use link, new password works, old one does not', async ({ page }) => {
    const user = await addUser(org, 'CUSTOMER');
    const since = now();
    await page.goto('/forgot-password');
    await page.getByLabel('Organisation (slug)').fill(org.slug);
    await page.getByLabel('Email').fill(user.email);
    await page.getByRole('button', { name: 'Email me a reset link' }).click();
    await expect(page.getByText('If that account exists')).toBeVisible();

    const link = linkIn(await waitForMail(user.email, 'Reset your password', since));
    await page.goto(link);
    await page.getByLabel('New password (8 to 72 characters)').fill('Brand-new-pass-1');
    await page.getByLabel('Repeat the new password').fill('Different-pass-2');
    await page.getByRole('button', { name: 'Set password' }).click();
    await expect(page.getByText('do not match')).toBeVisible();
    await page.getByLabel('New password (8 to 72 characters)').fill('Brand-new-pass-1');
    await page.getByLabel('Repeat the new password').fill('Brand-new-pass-1');
    await page.getByRole('button', { name: 'Set password' }).click();
    await expect(page).toHaveURL(/\/login\?reset=1/);
    await expect(page.getByText('Your password has been changed')).toBeVisible();

    expect((await rest('/auth/login', 'POST', { orgSlug: org.slug, email: user.email, password: PASSWORD })).status).toBe(401);
    expect((await rest('/auth/login', 'POST', { orgSlug: org.slug, email: user.email, password: 'Brand-new-pass-1' })).status).toBe(200);

    await page.goto(link); // the same link again
    await page.getByLabel('New password (8 to 72 characters)').fill('Third-pass-123');
    await page.getByLabel('Repeat the new password').fill('Third-pass-123');
    await page.getByRole('button', { name: 'Set password' }).click();
    await expect(page.getByText('invalid or has expired')).toBeVisible();
  });

  test('forgot password gives the same answer for an account that does not exist', async ({ page }) => {
    await page.goto('/forgot-password');
    await page.getByLabel('Organisation (slug)').fill(org.slug);
    await page.getByLabel('Email').fill(`nobody-${Date.now()}@${org.slug}.test`);
    await page.getByRole('button', { name: 'Email me a reset link' }).click();
    await expect(page.getByText('If that account exists')).toBeVisible();
  });

  test('changing your password signs out your other devices but not this one; "sign out of all devices" ends everything', async ({ page, browser, context }) => {
    const user = await addUser(org, 'AGENT');
    await signIn(page, org.slug, user.email);
    const otherContext = await browser.newContext();
    const other = await otherContext.newPage();
    await signIn(other, org.slug, user.email);

    await page.goto('/account');
    await page.getByLabel('Current password').fill('not-my-password');
    await page.getByLabel('New password (8 to 72 characters)').fill('Changed-pass-456');
    await page.getByLabel('Repeat the new password').fill('Changed-pass-456');
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page.getByText('Current password is wrong')).toBeVisible();
    await expect(page).toHaveURL(/\/account/); // an honest message, not a bounce to the login page

    await page.getByLabel('Current password').fill(PASSWORD);
    await page.getByLabel('New password (8 to 72 characters)').fill('Changed-pass-456');
    await page.getByLabel('Repeat the new password').fill('Changed-pass-456');
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page.getByText('Password changed')).toBeVisible();

    await visit(page, '/tickets');
    await expect(page.getByRole('heading', { name: 'Ticket queue' })).toBeVisible(); // this device stays signed in
    await otherContext.clearCookies({ name: 'helpdesk_token' });
    await visit(other, '/tickets');
    await expect(other).toHaveURL(/\/login/); // the other device does not

    await signIn(other, org.slug, user.email, 'Changed-pass-456');
    await page.goto('/account');
    await page.getByRole('button', { name: 'Sign out of all devices' }).click();
    await expect(page).toHaveURL(/\/login/);
    await otherContext.clearCookies({ name: 'helpdesk_token' });
    await visit(other, '/tickets');
    await expect(other).toHaveURL(/\/login/);
    await expect.poll(() => cookie(context, 'helpdesk_refresh')).toBeUndefined();
    await otherContext.close();
  });
});

test.describe('members (admin)', () => {
  test('deactivate, reactivate and change role take effect immediately', async ({ page, browser }) => {
    const agent = await addUser(org, 'AGENT');
    const adminContext = await browser.newContext();
    const admin = await adminContext.newPage();
    await signIn(admin, org.slug, org.admin.email);
    await signIn(page, org.slug, agent.email);
    await visit(page, '/tickets');
    await expect(page.locator('[data-connection=live]')).toBeVisible({ timeout: 15_000 }).catch(() => undefined);

    await admin.goto('/team');
    await expect(admin.getByRole('button', { name: `Deactivate ${agent.email}` })).toBeVisible();
    await expect(admin.getByRole('button', { name: `Deactivate ${org.admin.email}` })).toHaveCount(0); // admins cannot be changed here
    await admin.getByRole('button', { name: `Deactivate ${agent.email}` }).click();
    await expect(admin.getByText('Deactivated').first()).toBeVisible();

    expect((await rest('/auth/me', 'GET', undefined, agent.token)).status).toBe(401); // cut off at once
    await page.context().clearCookies({ name: 'helpdesk_token' });
    await visit(page, '/tickets');
    await expect(page).toHaveURL(/\/login/);
    await page.getByLabel('Organisation (slug)').fill(org.slug);
    await page.getByLabel('Email').fill(agent.email);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Invalid credentials')).toBeVisible();

    await admin.getByRole('button', { name: `Reactivate ${agent.email}` }).click();
    await expect(admin.getByText('Deactivated')).toHaveCount(0);
    await signIn(page, org.slug, agent.email);
    await expect(page.getByRole('heading', { name: 'Ticket queue' })).toBeVisible();

    await admin.getByLabel(`Role of ${agent.email}`).selectOption('CUSTOMER');
    // Wait for the change itself (the old token was already revoked by the deactivation above, so it proves nothing).
    await expect
      .poll(async () => (await rest<{ email: string; role: string }[]>('/team', 'GET', undefined, org.admin.token)).body.find((m) => m.email === agent.email)?.role)
      .toBe('CUSTOMER');
    await page.context().clearCookies({ name: 'helpdesk_token' });
    await visit(page, '/tickets');
    await expect(page).toHaveURL(/\/login/);
    await signIn(page, org.slug, agent.email);
    await expect(page.getByRole('heading', { name: 'My tickets' })).toBeVisible();
    await adminContext.close();
  });

  test('inviting without a password emails a link; the person chooses their own and logs in as an agent', async ({ page, browser }) => {
    const adminContext = await browser.newContext();
    const admin = await adminContext.newPage();
    await signIn(admin, org.slug, org.admin.email);
    await admin.goto('/team');
    const email = `newhire-${Date.now()}@${org.slug}.test`;
    const since = now();
    await admin.getByLabel('Email', { exact: true }).fill(email);
    await admin.locator('select[name=role]').selectOption('AGENT');
    await admin.getByRole('button', { name: 'Invite user' }).click();
    await expect(admin.getByText('emailed a link')).toBeVisible();
    await adminContext.close();

    await page.goto(linkIn(await waitForMail(email, 'invited', since)));
    await page.getByLabel('New password (8 to 72 characters)').fill('Chosen-by-me-789');
    await page.getByLabel('Repeat the new password').fill('Chosen-by-me-789');
    await page.getByRole('button', { name: 'Set password' }).click();
    await signIn(page, org.slug, email, 'Chosen-by-me-789');
    await expect(page.getByRole('heading', { name: 'Ticket queue' })).toBeVisible();
  });
});

test('the API refuses an access token after its session was ended elsewhere', async () => {
  const user = await addUser(org, 'CUSTOMER');
  const login = (await rest<{ accessToken: string; refreshToken: string }>('/auth/login', 'POST', { orgSlug: org.slug, email: user.email, password: PASSWORD })).body;
  expect((await rest('/auth/me', 'GET', undefined, login.accessToken)).status).toBe(200);
  await rest('/auth/logout', 'POST', { refreshToken: login.refreshToken });
  expect((await rest('/auth/me', 'GET', undefined, login.accessToken)).status).toBe(401);
  expect(API).toContain('/api/v1');
});
