import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { ROLES } from './role.js';
import type { Role } from './role.js';

export interface AuthenticatedUser {
  userId: string;
  orgId: string;
  role: Role;
}

export type AuthenticatedRequest = Request & { user: AuthenticatedUser };

interface JwtPayload {
  sub?: string;
  orgId?: string;
  role?: Role;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const [scheme, token] = request.headers.authorization?.split(' ') ?? [];
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Missing bearer token');
    }
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    if (
      !payload.sub ||
      !payload.orgId ||
      !payload.role ||
      !ROLES.includes(payload.role)
    ) {
      throw new UnauthorizedException('Invalid or expired token');
    }
    // orgId comes only from the verified token, never from the request body, params or query.
    request.user = {
      userId: payload.sub,
      orgId: payload.orgId,
      role: payload.role,
    };
    return true;
  }
}
