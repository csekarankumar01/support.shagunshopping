import 'server-only';
import { cookies } from 'next/headers';
import { sessionCookies } from './cookies';
import type { SessionTokens } from './cookies';
import { REFRESH_COOKIE, TOKEN_COOKIE } from './constants';

/**
 * A login is two httpOnly cookies: a short-lived access token (what every API call carries) and a long-lived
 * refresh token (only ever sent to the API's /auth/refresh and /auth/logout). Page JavaScript can read neither,
 * so a script-injection bug cannot steal them; the browser only sends them to this Next.js server, which adds the
 * Authorization header when it calls the API. `proxy.ts` renews the access token shortly before it expires.
 */
export async function getToken() {
  return (await cookies()).get(TOKEN_COOKIE)?.value;
}

export async function getRefreshToken() {
  return (await cookies()).get(REFRESH_COOKIE)?.value;
}

export async function setSession(tokens: SessionTokens) {
  const store = await cookies();
  for (const { name, value, ...options } of sessionCookies(tokens)) store.set(name, value, options);
}

export async function clearSession() {
  const store = await cookies();
  store.delete(TOKEN_COOKIE);
  store.delete(REFRESH_COOKIE);
}
