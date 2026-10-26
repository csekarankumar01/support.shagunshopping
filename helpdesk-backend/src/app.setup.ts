import { INestApplication, ValidationPipe } from '@nestjs/common';

/** Shared by main.ts and the e2e tests, so tests exercise exactly the production pipeline. */
export function configureApp(app: INestApplication) {
  // Behind the Next.js server (Docker), the client's address arrives in X-Forwarded-For. Trust that many hops, no more.
  const hops = Number(process.env.TRUST_PROXY ?? 0);
  if (hops > 0) app.getHttpAdapter().getInstance().set('trust proxy', hops);

  // transform: query-string numbers (page, limit) become real numbers via the DTO's @Type().
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
}
