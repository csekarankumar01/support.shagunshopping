import 'server-only';
import { cookies } from 'next/headers';
import { TOKEN_COOKIE } from './constants';

// Same lifetime as the JWT (JWT_EXPIRES_IN_SECONDS=3600 on the backend), so the browser
// drops the cookie at the moment the token stops being valid.
const MAX_AGE_SECONDS = 60 * 60;

/**
 * The JWT lives only in this httpOnly cookie. Page JavaScript cannot read it, so a script-injection
 * bug cannot steal it; the browser just attaches it to requests to this Next.js server, which adds
 * the Authorization header when it calls the API.
 */
export async function getToken() {
  return (await cookies()).get(TOKEN_COOKIE)?.value;
}

export async function setToken(token: string) {
  (await cookies()).set(TOKEN_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax', // not sent on cross-site POSTs: the browser-side half of CSRF protection
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function clearToken() {
  (await cookies()).delete(TOKEN_COOKIE);
}
