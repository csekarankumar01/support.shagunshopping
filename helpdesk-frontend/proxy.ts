import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { secondsLeft, sessionCookies } from '@/lib/cookies';
import type { SessionTokens } from '@/lib/cookies';
import { REFRESH_COOKIE, TOKEN_COOKIE } from '@/lib/constants';

const API_URL = process.env.API_URL ?? 'http://localhost:4310';
/** Renew the access token when less than this is left, so no request ever carries one about to expire. */
const RENEW_WITHIN_SECONDS = 30;

/** Replaces some cookies in a Cookie header, so the page rendered for THIS request already sees the new login. */
function withCookies(header: string, replacements: Record<string, string>) {
  const jar = new Map(
    header
      .split(/;\s*/)
      .filter(Boolean)
      .map((pair) => [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)] as const),
  );
  for (const [name, value] of Object.entries(replacements)) jar.set(name, value);
  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
}

/**
 * Runs before every protected page and the socket-token route. Keeps people logged in without ever showing them an
 * expired session: when the access token is missing or about to expire it trades the refresh token for a new pair
 * (server to server), stores both in the cookies, and lets the request continue. If that is not possible the visitor
 * is sent to /login (or gets a 401 for an API route). It does not prove a token is valid: the API checks every call.
 */
export async function proxy(request: NextRequest) {
  const access = request.cookies.get(TOKEN_COOKIE)?.value;
  const refresh = request.cookies.get(REFRESH_COOKIE)?.value;
  if (secondsLeft(access) > RENEW_WITHIN_SECONDS) return NextResponse.next();

  const wantsJson = request.nextUrl.pathname.startsWith('/api/');
  const signedOut = (expired: boolean) => {
    const response = wantsJson
      ? NextResponse.json({ error: 'unauthorized' }, { status: 401 })
      : NextResponse.redirect(new URL(expired ? '/login?expired=1' : '/login', request.url));
    response.cookies.delete(TOKEN_COOKIE);
    response.cookies.delete(REFRESH_COOKIE);
    return response;
  };
  if (!refresh) return signedOut(Boolean(access)); // an invalid or expired cookie deserves the "session ended" notice; no cookie does not

  let tokens: SessionTokens;
  try {
    const forwarded = request.headers.get('x-forwarded-for');
    const res = await fetch(`${API_URL}/api/v1/auth/refresh`, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', ...(forwarded && { 'X-Forwarded-For': forwarded }) },
      body: JSON.stringify({ refreshToken: refresh }),
    });
    if (!res.ok) return signedOut(true); // revoked, expired or reused: the login really is over
    tokens = (await res.json()) as SessionTokens;
  } catch {
    // The API is unreachable. Do not log anyone out for that: let the request through and the page will say so.
    return NextResponse.next();
  }

  const headers = new Headers(request.headers);
  headers.set(
    'cookie',
    withCookies(request.headers.get('cookie') ?? '', {
      [TOKEN_COOKIE]: tokens.accessToken,
      [REFRESH_COOKIE]: tokens.refreshToken,
    }),
  );
  const response = NextResponse.next({ request: { headers } });
  for (const { name, value, ...options } of sessionCookies(tokens)) response.cookies.set(name, value, options);
  return response;
}

export const config = {
  matcher: [
    '/tickets/:path*',
    '/team/:path*',
    '/dashboard/:path*',
    '/canned/:path*',
    '/notifications/:path*',
    '/account/:path*',
    '/api/socket-token',
  ],
};
