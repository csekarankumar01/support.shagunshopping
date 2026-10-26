import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  // On SIGTERM (what `docker stop` sends) finish in-flight work, stop the consumers and the relay, remove this
  // instance's presence entries and close the connections, instead of being killed mid-request.
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 4310);
}
await bootstrap();
