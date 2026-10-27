import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Redis } from 'ioredis';
import type { ServerOptions } from 'socket.io';

/**
 * Lets several API instances behave as one chat server.
 * Socket.io keeps its rooms in each process's memory, so a message published on instance A would never reach a
 * browser connected to instance B. With this adapter every broadcast also goes through Redis, and each instance
 * delivers it to its own sockets. Nothing else in the code changes: `server.to(room).emit(...)` just works across
 * instances. (Redis being down only means each instance can reach its own sockets; they keep running.)
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly clients: Redis[] = [];
  private factory?: ReturnType<typeof createAdapter>;

  constructor(
    app: INestApplicationContext,
    private readonly redis: Redis,
    private readonly keyPrefix = '',
  ) {
    super(app);
  }

  connect() {
    const pub = this.redis.duplicate();
    const sub = this.redis.duplicate();
    for (const client of [pub, sub]) client.on('error', () => undefined); // the main client reports connection trouble
    this.clients.push(pub, sub);
    // @socket.io/redis-adapter fires some Redis commands without awaiting or catching them: publish() on every
    // broadcast, unsubscribe()/punsubscribe() in close(). At shutdown a socket disconnects, the gateway announces that
    // ("went offline") and the adapter publishes it just after the connection has been closed, so ioredis rejects the
    // command with "Connection is closed" and the rejection has no handler: Node counts it as an unhandled rejection,
    // which also made the CI test run exit with an error. A broadcast that cannot be delivered because Redis is gone
    // has no one left to receive it, so the failure is simply ignored.
    this.ignoreFailures(pub, ['publish']);
    this.ignoreFailures(sub, ['unsubscribe', 'punsubscribe']);
    this.factory = createAdapter(pub, sub, {
      key: `${this.keyPrefix}socket.io`,
    });
  }

  /** Makes the named commands of a client return a promise whose failure is already handled. */
  private ignoreFailures(client: Redis, commands: string[]) {
    for (const command of commands) {
      const original = (client as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>)[command].bind(client);
      (client as unknown as Record<string, unknown>)[command] = (...args: unknown[]) => {
        const pending = original(...args);
        pending.catch(() => undefined);
        return pending;
      };
    }
  }

  createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, options) as ReturnType<
      IoAdapter['createIOServer']
    >;
    if (this.factory) server.adapter(this.factory);
    return server;
  }

  /**
   * Closing the socket servers makes the adapter send its last Redis commands (unsubscribe, ...). Those must finish
   * while the connections are still open, so the servers close first and the connections are closed politely
   * afterwards (QUIT). Cutting the connections first rejected those in-flight commands with "Connection is closed",
   * which nothing was waiting for: an unhandled rejection that also made the CI test run exit with an error.
   */
  async dispose() {
    await super.dispose();
    await Promise.all(
      this.clients.map((client) =>
        client.quit().catch(() => client.disconnect()),
      ),
    );
  }
}
