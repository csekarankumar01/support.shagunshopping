import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from './jwt-auth.guard.js';
import type { Role } from './role.js';
import { ROLES_KEY } from './roles.decorator.js';

/** Must run after JwtAuthGuard, because it reads request.user. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const allowed = this.reflector.getAllAndOverride<Role[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    // Deny by default: a route using this guard without @Roles() is a mistake, not an open door.
    if (!allowed || allowed.length === 0) {
      throw new ForbiddenException('No roles configured for this route');
    }
    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!user || !allowed.includes(user.role)) {
      throw new ForbiddenException('Insufficient role');
    }
    return true;
  }
}
