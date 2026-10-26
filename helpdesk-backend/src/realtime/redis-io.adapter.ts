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
    this.factory = createAdapter(pub, sub, {
      key: `${this.keyPrefix}socket.io`,
    });
  }

  createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, options) as ReturnType<
      IoAdapter['createIOServer']
    >;
    if (this.factory) server.adapter(this.factory);
    return server;
  }

  dispose() {
    for (const client of this.clients) client.disconnect();
    return super.dispose();
  }
}
