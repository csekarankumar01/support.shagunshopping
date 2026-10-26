import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { TOKEN_COOKIE } from '@/lib/constants';

// A fast, optimistic check only: no cookie at all means "go and log in" before any page renders.
// It does not prove the cookie is valid. The real check is the API, which verifies the token on
// every call (see lib/api.ts), so removing this file would cost speed, not security.
export function proxy(request: NextRequest) {
  if (!request.cookies.has(TOKEN_COOKIE)) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/tickets/:path*', '/team/:path*', '/dashboard/:path*', '/canned/:path*', '/notifications/:path*'],
};
