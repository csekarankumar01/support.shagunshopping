import {
  Controller,
  Get,
  Inject,
  Module,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Redis } from 'ioredis';
import { DatabaseModule } from '../database/database.module.js';
import { DatabaseService } from '../database/database.service.js';
import { REDIS } from '../redis/redis.module.js';

const within = <T>(work: Promise<T>, ms = 2000) =>
  Promise.race([
    work,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), ms),
    ),
  ]);

/** For Docker and load balancers: is this instance able to do its job? No login needed, no data revealed. */
@Controller('api/v1/health')
export class HealthController {
  constructor(
    private readonly db: DatabaseService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Get()
  async check() {
    const [database, redis] = await Promise.all([
      within(this.db.query('SELECT 1')).then(
        () => 'up',
        () => 'down',
      ),
      within(this.redis.ping()).then(
        () => 'up',
        () => 'down',
      ),
    ]);
    const body = {
      status: database === 'up' ? 'ok' : 'unavailable',
      database,
      redis,
    };
    // Redis is a nicety (presence, limits, SLA timers) the API survives without, so only the database is fatal.
    if (database !== 'up') throw new ServiceUnavailableException(body);
    return body;
  }
}

@Module({ imports: [DatabaseModule], controllers: [HealthController] })
export class HealthModule {}
