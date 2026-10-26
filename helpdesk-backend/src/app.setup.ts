import { INestApplication, ValidationPipe } from '@nestjs/common';

/** Shared by main.ts and the e2e tests, so tests exercise exactly the production pipeline. */
export function configureApp(app: INestApplication) {
  // transform: query-string numbers (page, limit) become real numbers via the DTO's @Type().
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
}
