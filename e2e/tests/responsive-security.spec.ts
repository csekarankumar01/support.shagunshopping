import { expect, test } from '@playwright/test';
import { API, createOrg, createTicket, rest, signIn } from './helpers';
import type { Org } from './helpers';

let org: Org;
let ticket: string;
test.beforeAll(async () => {
  org = await createOrg('rs');
  ticket = await createTicket(org.customer.token, 'Layout check ' + 'a-very-long-subject-without-spaces-'.repeat(4), 'HIGH');
  await rest(`/tickets/${ticket}/comments`, 'POST', { message: 'x'.repeat(200) }, org.customer.token); // one unbroken 200-character "word"
});

test.describe('phone-sized screen (375 px wide): nothing scrolls sideways', () => {
  test.use({ viewport: { width: 375, height: 812 } });
  const noSidewaysScroll = async (page: import('@playwright/test').Page, where: string) => {
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${where} is ${overflow}px too wide`).toBeLessThanOrEqual(0);
  };

  test('public pages', async ({ page }) => {
    for (const path of ['/login', '/register', '/forgot-password', '/verify-email?org=demo&email=someone@example.com']) {
      await page.goto(path);
      await noSidewaysScroll(page, path);
    }
  });

  test('customer pages, including an unbroken 200-character word', async ({ page }) => {
    await signIn(page, org.slug, org.customer.email);
    await noSidewaysScroll(page, 'ticket list');
    await page.goto(`/tickets/${ticket}`);
    await expect(page.getByText('x'.repeat(200))).toBeVisible();
    await noSidewaysScroll(page, 'ticket page');
    await page.goto('/account');
    await noSidewaysScroll(page, 'account');
  });

  test('staff pages', async ({ page }) => {
    await signIn(page, org.slug, org.admin.email);
    for (const path of ['/tickets', '/dashboard', '/canned', '/team', '/notifications', `/tickets/${ticket}`]) {
      await page.goto(path);
      await noSidewaysScroll(page, path);
    }
  });
});

test.describe('security headers and cookies', () => {
  test('the web app sends the protective headers on every page', async ({ request }) => {
    for (const path of ['/login', '/register', '/forgot-password', '/verify-email?org=demo&email=someone@example.com']) {
      const res = await request.get(path);
      expect(res.headers()['x-frame-options']).toBe('DENY');
      expect(res.headers()['x-content-type-options']).toBe('nosniff');
      expect(res.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
      expect(res.headers()['referrer-policy']).toBeTruthy();
      expect(res.headers()['permissions-policy']).toContain('camera=()');
    }
  });

  test('the API sends protective headers, hides its framework and keeps metrics private', async () => {
    const health = await fetch(`${API}/health`);
    expect(health.headers.get('x-content-type-options')).toBe('nosniff');
    expect(health.headers.get('x-powered-by')).toBeNull();
    expect(health.headers.get('strict-transport-security')).toBeTruthy();
    expect((await fetch(`${API}/metrics`)).status).toBeGreaterThanOrEqual(401); // 404 when switched off, 401 without the token
  });

  test('protected pages and the socket-token route refuse visitors with no login', async ({ page, request }) => {
    await page.goto('/tickets');
    await expect(page).toHaveURL(/\/login$/);
    const res = await request.get('/api/socket-token');
    expect(res.status()).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
  });

  test('the socket-token route hands out only a short-lived socket token, never the login token', async ({ page, context }) => {
    await signIn(page, org.slug, org.agent.email);
    const login = (await context.cookies()).find((c) => c.name === 'helpdesk_token')!.value;
    const { token } = (await (await page.request.get('/api/socket-token')).json()) as { token: string };
    expect(token).not.toBe(login);
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    expect(claims.purpose).toBe('socket');
    expect(claims.exp - claims.iat).toBe(60);
    expect((await rest('/auth/me', 'GET', undefined, token)).status).toBe(401); // useless against the REST API
  });
});
