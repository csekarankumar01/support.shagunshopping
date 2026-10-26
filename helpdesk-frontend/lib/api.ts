import 'server-only';
import { redirect } from 'next/navigation';
import { getToken } from './session';

// Server to server: the browser never talks to this URL, so the API needs no CORS configuration.
const API_URL = process.env.API_URL ?? 'http://localhost:4310';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** The raw call, with no redirect on failure: for route handlers, which must answer with a status, not a page. */
export async function apiRequest<T>(path: string, method: string, body?: unknown, token?: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(503, 'Cannot reach the helpdesk API. Is the backend running?');
  }
  if (!res.ok) {
    // NestJS errors look like { statusCode, message: string | string[], error }.
    const data = (await res.json().catch(() => null)) as { message?: string | string[] } | null;
    const message = Array.isArray(data?.message) ? data.message.join('. ') : data?.message;
    throw new ApiError(res.status, message ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

/** For the two endpoints that need no login: register-org and login. */
export const apiPublic = <T>(path: string, body: unknown) => apiRequest<T>(path, 'POST', body);

/** Calls the API as the logged-in user. No cookie, or a token the API rejects, sends the visitor to /login. */
export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}) {
  const token = await getToken();
  if (!token) redirect('/login');
  try {
    return await apiRequest<T>(path, options.method ?? 'GET', options.body, token);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect('/login?expired=1');
    throw err;
  }
}
