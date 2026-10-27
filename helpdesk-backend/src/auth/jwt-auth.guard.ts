import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { AccountStateService } from './account-state.service.js';
import { RevocationService } from './revocation.service.js';
import { verifyToken } from './verify-token.js';
import type { AuthenticatedUser } from './verify-token.js';

export type { AuthenticatedUser } from './verify-token.js';

export type AuthenticatedRequest = Request & {
  user: AuthenticatedUser;
  /** The login session behind this request (revoked by logout, deactivation, password change). */
  sid: string;
  /** When that session's access token expires (unix seconds). */
  sessionExp: number;
};

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly revocation: RevocationService,
    private readonly accounts: AccountStateService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const [scheme, token] = request.headers.authorization?.split(' ') ?? [];
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const { user, sid, sessionExp } = await verifyToken(
      this.jwt,
      token,
      'access',
    );
    if (await this.revocation.isRevoked(sid)) {
      throw new UnauthorizedException('Invalid or expired token'); // same message as any other bad token
    }
    // A person switched off, an organisation suspended or a role changed directly in the database leaves no
    // revoked session behind, so ask the database (cached for a few seconds).
    if (!(await this.accounts.isCurrent(user))) {
      throw new UnauthorizedException('Invalid or expired token');
    }
    request.user = user;
    request.sid = sid;
    request.sessionExp = sessionExp;
    return true;
  }
}
