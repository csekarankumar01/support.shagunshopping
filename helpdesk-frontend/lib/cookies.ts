import { REFRESH_COOKIE, TOKEN_COOKIE } from './constants';

/** What the API returns on login and refresh. */
export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  /** Lifetime of the access token, in seconds. */
  expiresIn: number;
}

const REFRESH_DAYS = 14; // matches the API's refresh-token lifetime

const common = {
  httpOnly: true, // page JavaScript can never read either token
  sameSite: 'lax' as const, // not sent on cross-site POSTs: the browser-side half of CSRF protection
  secure: process.env.NODE_ENV === 'production',
  path: '/',
};

/** The two cookies that make up a login: a short-lived access token and a long-lived refresh token. */
export const sessionCookies = (tokens: SessionTokens) => [
  { name: TOKEN_COOKIE, value: tokens.accessToken, ...common, maxAge: tokens.expiresIn },
  { name: REFRESH_COOKIE, value: tokens.refreshToken, ...common, maxAge: REFRESH_DAYS * 86_400 },
];

/** Seconds until a JWT expires, read from its payload. Only used to decide when to refresh: the API does the checking. */
export function secondsLeft(token: string | undefined): number {
  if (!token) return -1;
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return (JSON.parse(atob(payload)) as { exp: number }).exp - Date.now() / 1000;
  } catch {
    return -1;
  }
}
