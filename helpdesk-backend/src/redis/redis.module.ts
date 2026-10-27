import {
  Global,
  Inject,
  Logger,
  Module,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

export const REDIS = Symbol('REDIS');

/** One shared Redis connection for presence now and SLA timers later. Redis being down must not take the API down. */
@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const logger = new Logger('Redis');
        const options = {
          maxRetriesPerRequest: 2,
          // Optional namespace for every key (tests use "test:" so they never touch the real keys).
          keyPrefix: config.get<string>('REDIS_KEY_PREFIX', ''),
        };
        // REDIS_URL (redis:// or rediss:// for TLS, password inside) is what hosted Redis gives you; otherwise the
        // separate host, port and password of the local Docker setup.
        const url = config.get<string>('REDIS_URL');
        const client = url
          ? new Redis(url, options)
          : new Redis({
              host: config.getOrThrow<string>('REDIS_HOST'),
              port: Number(config.getOrThrow<string>('REDIS_PORT')),
              password: config.getOrThrow<string>('REDIS_PASSWORD'),
              ...options,
            });
        client.on('error', (err) =>
          logger.warn(`connection problem: ${err.message}`),
        );
        return client;
      },
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown() {
    await this.redis.quit().catch(() => this.redis.disconnect());
  }
}
