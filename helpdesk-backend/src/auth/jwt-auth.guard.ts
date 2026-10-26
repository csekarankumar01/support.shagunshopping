import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { verifyToken } from './verify-token.js';
import type { AuthenticatedUser } from './verify-token.js';

export type { AuthenticatedUser } from './verify-token.js';

export type AuthenticatedRequest = Request & {
  user: AuthenticatedUser;
  /** When the login session behind this request ends (unix seconds). */
  sessionExp: number;
};

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const [scheme, token] = request.headers.authorization?.split(' ') ?? [];
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const { user, sessionExp } = await verifyToken(this.jwt, token, 'access');
    request.user = user;
    request.sessionExp = sessionExp;
    return true;
  }
}
