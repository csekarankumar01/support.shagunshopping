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
/** A socket counts as live if its last heartbeat is newer than this (three missed beats). */
const ONLINE_WINDOW_MS = 60_000;

const key = (orgId: string) => `presence:${orgId}`;
const member = (userId: string, socketId: string) => `${userId}:${socketId}`;
const userOf = (entry: string) => entry.slice(0, entry.indexOf(':'));

/**
 * Which staff are online, per organisation, correct with any number of API instances.
 *
 * Redis sorted set `presence:{orgId}`: one member per open socket (`userId:socketId`), scored by its last heartbeat.
 * A user is online while at least one of their sockets has a recent heartbeat, wherever it is connected.
 *  - Each instance refreshes only its own sockets every 20 s.
 *  - A clean disconnect removes that socket's entry at once.
 *  - A crashed instance cannot leave ghosts: its sockets stop beating and fall out of the window, and are swept.
 */
@Injectable()
export class PresenceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PresenceService.name);
  private readonly local = new Set<string>(); // `${orgId}|${userId}|${socketId}` of sockets on THIS instance
  private timer?: ReturnType<typeof setInterval>;

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.heartbeat(), HEARTBEAT_MS);
    this.timer.unref();
  }

  async onModuleDestroy() {
    clearInterval(this.timer);
    // Leave no entries behind on a clean shutdown.
    await Promise.allSettled(
      [...this.local].map((entry) => {
        const [orgId, userId, socketId] = entry.split('|');
        return this.redis.zrem(key(orgId), member(userId, socketId));
      }),
    );
    this.local.clear();
  }

  /** Returns true when this user has just come online (this was their first live socket anywhere). */
  async connect(
    orgId: string,
    userId: string,
    socketId: string,
  ): Promise<boolean> {
    this.local.add(`${orgId}|${userId}|${socketId}`);
    const live = await this.safely(async () => {
      await this.redis.zadd(key(orgId), Date.now(), member(userId, socketId));
      return this.liveSockets(orgId, userId);
    });
    return live === 1;
  }

  /** Returns true when this user has just gone offline (their last live socket, anywhere, closed). */
  async disconnect(
    orgId: string,
    userId: string,
    socketId: string,
  ): Promise<boolean> {
    this.local.delete(`${orgId}|${userId}|${socketId}`);
    const live = await this.safely(async () => {
      await this.redis.zrem(key(orgId), member(userId, socketId));
      return this.liveSockets(orgId, userId);
    });
    return live === 0;
  }

  async listOnline(orgId: string): Promise<string[]> {
    const live = await this.safely(() => this.liveMembers(orgId, true));
    return [...new Set((live ?? []).map(userOf))];
  }

  private async liveSockets(orgId: string, userId: string) {
    return (await this.liveMembers(orgId, false)).filter(
      (entry) => userOf(entry) === userId,
    ).length;
  }

  private async liveMembers(orgId: string, sweep: boolean) {
    const cutoff = Date.now() - ONLINE_WINDOW_MS;
    if (sweep) await this.redis.zremrangebyscore(key(orgId), '-inf', cutoff); // forget the dead
    return this.redis.zrangebyscore(key(orgId), cutoff, '+inf');
  }

  private async heartbeat() {
    const now = Date.now();
    await this.safely(async () => {
      const pipeline = this.redis.pipeline();
      for (const entry of this.local) {
        const [orgId, userId, socketId] = entry.split('|');
        pipeline.zadd(key(orgId), now, member(userId, socketId));
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
