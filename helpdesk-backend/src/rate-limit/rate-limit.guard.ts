import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  SetMetadata,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Redis } from 'ioredis';
import type { Request, Response } from 'express';
import { REDIS } from '../redis/redis.module.js';

export interface RateLimitOptions {
  /** Names the counter, so different routes do not share a budget. */
  name: string;
  limit: number;
  windowSeconds: number;
  /** Who is counted: the caller's IP, the logged-in user, or the account being logged in to. */
  by: 'ip' | 'user' | 'login-account';
}

const KEY = 'rate-limit';
export const RateLimit = (options: RateLimitOptions) =>
  SetMetadata(KEY, options);

/**
 * Fixed-window rate limiting in Redis (plan: "Redis: API rate limiting").
 * - Over the limit: 429 with Retry-After. Redis unreachable: the request is allowed (fail open), because losing
 *   the limiter must not take the API down.
 * - "login-account" counts per organisation+email, so guessing one account's password is slowed down no matter
 *   how many addresses the guesses come from. "ip" uses req.ip, which is the real client only when Express is
 *   told which proxy to trust (TRUST_PROXY, set in Docker where the Next.js server forwards X-Forwarded-For).
 * - Use after JwtAuthGuard for `by: 'user'`.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.get<RateLimitOptions | undefined>(
      KEY,
      context.getHandler(),
    );
    if (!options || this.config.get<string>('RATE_LIMIT_DISABLED') === 'true')
      return true;

    const http = context.switchToHttp();
    const request = http.getRequest<Request & { user?: { userId: string } }>();
    const subject = this.subjectOf(options.by, request);
    if (!subject) return true;

    const key = `rl:${options.name}:${subject}`;
    try {
      const [, [, count]] = (await this.redis
        .multi()
        .set(key, 0, 'EX', options.windowSeconds, 'NX') // start the window once...
        .incr(key) // ...then count
        .exec()) as [unknown, [unknown, number]];
      if (count > options.limit) {
        const ttl = await this.redis.ttl(key);
        http
          .getResponse<Response>()
          .setHeader('Retry-After', String(Math.max(ttl, 1)));
        throw new HttpException(
          'Too many requests. Please wait a moment and try again.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.warn(
        `rate limiter unavailable, allowing request: ${(err as Error).message}`,
      );
    }
    return true;
  }

  private subjectOf(
    by: RateLimitOptions['by'],
    request: Request & { user?: { userId: string } },
  ) {
    if (by === 'ip') return request.ip;
    if (by === 'user') return request.user?.userId;
    const body = request.body as
      { orgSlug?: unknown; email?: unknown } | undefined;
    if (typeof body?.orgSlug !== 'string' || typeof body?.email !== 'string')
      return undefined;
    return `${body.orgSlug.toLowerCase()}:${body.email.toLowerCase()}`;
  }
}
