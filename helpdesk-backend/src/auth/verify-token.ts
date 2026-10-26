import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ROLES } from './role.js';
import type { Role } from './role.js';

export interface AuthenticatedUser {
  userId: string;
  orgId: string;
  role: Role;
}

interface JwtPayload {
  sub?: string;
  orgId?: string;
  role?: Role;
  purpose?: string;
  sessionExp?: number;
  exp?: number;
}

/** Seconds a socket token lives. It only has to survive the handshake. */
export const SOCKET_TOKEN_TTL_SECONDS = 60;

export interface VerifiedToken {
  user: AuthenticatedUser;
  /** When the login session this token came from ends (unix seconds). */
  sessionExp: number;
}

/**
 * The one place a token is checked, for both the REST guard and the WebSocket handshake.
 * A normal login token and a socket token are different things and are never interchangeable:
 *   - 'access' (REST): must NOT carry a purpose, so a leaked 60-second socket token cannot call the API.
 *   - 'socket' (handshake): must carry purpose 'socket', so the long-lived login token is never accepted
 *     (and never needs to be handed to the browser).
 * Any failure is the same error, so callers cannot learn why a token was refused.
 */
export async function verifyToken(
  jwt: JwtService,
  token: string,
  kind: 'access' | 'socket',
): Promise<VerifiedToken> {
  let payload: JwtPayload;
  try {
    payload = await jwt.verifyAsync<JwtPayload>(token);
  } catch {
    throw new UnauthorizedException('Invalid or expired token');
  }
  const purposeOk =
    kind === 'socket'
      ? payload.purpose === 'socket'
      : payload.purpose === undefined;
  if (
    !purposeOk ||
    !payload.sub ||
    !payload.orgId ||
    !payload.role ||
    !ROLES.includes(payload.role) ||
    typeof payload.exp !== 'number'
  ) {
    throw new UnauthorizedException('Invalid or expired token');
  }
  // A socket token carries the end of the session it was minted from; for a login token that is its own expiry.
  const sessionExp =
    kind === 'socket' && typeof payload.sessionExp === 'number'
      ? payload.sessionExp
      : payload.exp;
  // orgId comes only from the verified token, never from the request body, params or query.
  return {
    user: { userId: payload.sub, orgId: payload.orgId, role: payload.role },
    sessionExp,
  };
}
