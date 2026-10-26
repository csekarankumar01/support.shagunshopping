import { NextResponse } from 'next/server';
import { ApiError, apiRequest } from '@/lib/api';
import { getToken } from '@/lib/session';

/**
 * The browser cannot read the httpOnly login cookie, so it asks this same-origin endpoint for a token to use
 * in the WebSocket handshake. This route reads the cookie, has the API mint a 60-second, socket-only token
 * (useless against the REST API), and returns just that. The login token itself never reaches the page.
 *
 * Another site cannot use this to log in as the visitor: a cross-origin page may trigger the request but the
 * browser will not let it read the answer.
 */
export async function GET() {
  const noStore = { 'Cache-Control': 'no-store' };
  const token = await getToken();
  if (!token) return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: noStore });
  try {
    const data = await apiRequest<{ token: string }>('/api/v1/auth/socket-token', 'POST', undefined, token);
    return NextResponse.json({ token: data.token }, { headers: noStore });
  } catch (err) {
    // 401 means the session has ended; anything else (API down) is reported as a bad gateway.
    const status = err instanceof ApiError && err.status === 401 ? 401 : 502;
    return NextResponse.json({ error: status === 401 ? 'unauthorized' : 'unavailable' }, { status, headers: noStore });
  }
}
