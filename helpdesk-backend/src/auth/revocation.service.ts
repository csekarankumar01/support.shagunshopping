import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import { REDIS } from '../redis/redis.module.js';

const KEY = (sid: string) => `auth:revoked-sid:${sid}`;

/**
 * Cuts a login session off immediately.
 *
 * An access token is a signed, self-contained pass that lives for about fifteen minutes, so nothing on the server
 * can "take it back". Instead every token carries a session id (`sid`), and when a session ends (logout, password
 * change, deactivation, role change) its id goes on this list for as long as the token could still be valid.
 * The API and the WebSocket gateway check the list on every request / connection. The same call announces the
 * change on a Redis channel, so any API instance can disconnect that session's open sockets at once.
 *
 * If Redis is down the check is skipped (fail open): the token still expires on its own within minutes, and an
 * outage of a cache must not lock every user out.
 */
@Injectable()
export class RevocationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RevocationService.name);
  private readonly ttlSeconds: number;
  /** Pub/sub channels are not covered by the client's key prefix, so the prefix is added by hand. */
  private readonly channel: string;
  private subscriber?: Redis;
  private readonly listeners = new Set<(sids: string[]) => void>();

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    config: ConfigService,
  ) {
    // Longer than any access token lives, so an entry can never expire while its token is still usable.
    this.channel = `${config.get<string>('REDIS_KEY_PREFIX', '')}auth:revoked`;
    this.ttlSeconds =
      Number(config.get<string>('JWT_EXPIRES_IN_SECONDS', '900')) + 120;
  }

  async onModuleInit() {
    try {
      this.subscriber = this.redis.duplicate();
      this.subscriber.on('error', () => undefined); // reconnects by itself; the main client logs problems
      await this.subscriber.subscribe(this.channel);
      this.subscriber.on('message', (_channel, message) => {
        try {
          const { sids } = JSON.parse(message) as { sids: string[] };
          this.listeners.forEach((listener) => listener(sids));
        } catch {
          /* a malformed message is ignored */
        }
      });
    } catch (err) {
      this.logger.warn(
        `cannot subscribe to revocations: ${(err as Error).message}`,
      );
    }
  }

  onModuleDestroy() {
    this.subscriber?.disconnect();
  }

  /** The gateway registers here to disconnect sockets of revoked sessions. */
  onRevoked(listener: (sids: string[]) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async revokeSessions(sids: string[]) {
    if (!sids.length) return;
    try {
      const pipeline = this.redis.pipeline();
      for (const sid of sids)
        pipeline.set(KEY(sid), '1', 'EX', this.ttlSeconds);
      pipeline.publish(this.channel, JSON.stringify({ sids }));
      await pipeline.exec();
    } catch (err) {
      this.logger.error(
        `could not record revoked sessions: ${(err as Error).message}`,
      );
    }
  }

  async isRevoked(sid: string): Promise<boolean> {
    try {
      return (await this.redis.exists(KEY(sid))) === 1;
    } catch (err) {
      this.logger.warn(
        `revocation check skipped, Redis unavailable: ${(err as Error).message}`,
      );
      return false;
    }
  }
}
