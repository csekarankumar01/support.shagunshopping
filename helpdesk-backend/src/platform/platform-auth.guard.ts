import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { DatabaseService } from '../database/database.service.js';
import { PLATFORM_PURPOSE } from './platform.service.js';
import type { PlatformAdmin } from './platform.service.js';

export type PlatformRequest = Request & { admin: PlatformAdmin };

/**
 * Accepts ONLY a platform token (purpose "platform"). A normal tenant token, which has no such purpose, is refused
 * here, and verifyToken() refuses a platform token on every tenant route and on the WebSocket, so the two worlds
 * cannot be mixed. The admin must also still be active, checked in the database on every request, so deactivating
 * a platform admin takes effect at once.
 */
@Injectable()
export class PlatformAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly db: DatabaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<PlatformRequest>();
    const [scheme, token] = request.headers.authorization?.split(' ') ?? [];
    const fail = () => new UnauthorizedException('Invalid or expired token');
    if (scheme !== 'Bearer' || !token) throw fail();
    let payload: { sub?: string; email?: string; purpose?: string };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw fail();
    }
    if (
      payload.purpose !== PLATFORM_PURPOSE ||
      !payload.sub ||
      !payload.email
    ) {
      throw fail();
    }
    const { rows } = await this.db.query<{ active: boolean }>(
      'SELECT platform_admin_is_active($1) AS active',
      [payload.sub],
    );
    if (!rows[0]?.active) throw fail();
    request.admin = { id: payload.sub, email: payload.email };
    return true;
  }
}
