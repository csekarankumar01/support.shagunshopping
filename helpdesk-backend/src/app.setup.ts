import { INestApplication, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import type { Redis } from 'ioredis';
import { RedisIoAdapter } from './realtime/redis-io.adapter.js';
import { REDIS } from './redis/redis.module.js';

/** Shared by main.ts and the e2e tests, so tests exercise exactly the production pipeline. */
export function configureApp(app: INestApplication) {
  // Behind the Next.js server (Docker), the client's address arrives in X-Forwarded-For. Trust that many hops, no more.
  const hops = Number(process.env.TRUST_PROXY ?? 0);
  if (hops > 0) app.getHttpAdapter().getInstance().set('trust proxy', hops);

  // Security headers on every response: no sniffing, no framing, no referrer leaks, HSTS when served over HTTPS.
  // (This API only returns JSON, so the default content-security-policy is safe.)
  app.use(helmet());

  // transform: query-string numbers (page, limit) become real numbers via the DTO's @Type().
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Chat that works with more than one API instance (rooms and broadcasts shared through Redis).
  const redis = app.get<Redis>(REDIS, { strict: false });
  const adapter = new RedisIoAdapter(
    app,
    redis,
    process.env.REDIS_KEY_PREFIX ?? '',
  );
  adapter.connect();
  app.useWebSocketAdapter(adapter);
}
