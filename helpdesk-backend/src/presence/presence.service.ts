import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS } from '../redis/redis.module.js';

const HEARTBEAT_MS = 20_000;
/** An agent counts as online if their last heartbeat is newer than this (three missed beats). */
const ONLINE_WINDOW_MS = 60_000;

const key = (orgId: string) => `presence:${orgId}`;

/**
 * Which staff are online, per organisation: a Redis sorted set `presence:{orgId}` of userId scored by last heartbeat.
 * A server that dies without saying goodbye cannot leave anyone "online" forever: its heartbeats stop, and entries
 * older than the window are ignored and swept. Sockets are counted in memory, so a user with two tabs stays online
 * until the last one closes.
 */
@Injectable()
export class PresenceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PresenceService.name);
  private readonly sockets = new Map<string, number>(); // `${orgId}|${userId}` -> open sockets on this instance
  private timer?: ReturnType<typeof setInterval>;

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.heartbeat(), HEARTBEAT_MS);
    this.timer.unref();
  }

  async onModuleDestroy() {
    clearInterval(this.timer);
    // Leave no stale entries behind on a clean shutdown.
    await Promise.allSettled(
      [...this.sockets.keys()].map((entry) => {
        const [orgId, userId] = entry.split('|');
        return this.redis.zrem(key(orgId), userId);
      }),
    );
    this.sockets.clear();
  }

  /** Returns true when this user has just come online (their first open socket). */
  async connect(orgId: string, userId: string): Promise<boolean> {
    const entry = `${orgId}|${userId}`;
    const count = (this.sockets.get(entry) ?? 0) + 1;
    this.sockets.set(entry, count);
    await this.safely(() => this.redis.zadd(key(orgId), Date.now(), userId));
    return count === 1;
  }

  /** Returns true when this user has just gone offline (their last socket closed). */
  async disconnect(orgId: string, userId: string): Promise<boolean> {
    const entry = `${orgId}|${userId}`;
    const count = (this.sockets.get(entry) ?? 1) - 1;
    if (count > 0) {
      this.sockets.set(entry, count);
      return false;
    }
    this.sockets.delete(entry);
    await this.safely(() => this.redis.zrem(key(orgId), userId));
    return true;
  }

  async listOnline(orgId: string): Promise<string[]> {
    const cutoff = Date.now() - ONLINE_WINDOW_MS;
    const result = await this.safely(async () => {
      await this.redis.zremrangebyscore(key(orgId), '-inf', cutoff); // sweep the dead
      return this.redis.zrangebyscore(key(orgId), cutoff, '+inf');
    });
    return result ?? [];
  }

  private async heartbeat() {
    const now = Date.now();
    await this.safely(async () => {
      const pipeline = this.redis.pipeline();
      for (const entry of this.sockets.keys()) {
        const [orgId, userId] = entry.split('|');
        pipeline.zadd(key(orgId), now, userId);
      }
      await pipeline.exec();
    });
  }

  /** Presence is a nicety: when Redis is unreachable the API keeps working and just reports nobody online. */
  private async safely<T>(operation: () => Promise<T>): Promise<T | undefined> {
    try {
      return await operation();
    } catch (err) {
      this.logger.warn(`Redis unavailable: ${(err as Error).message}`);
      return undefined;
    }
  }
}
