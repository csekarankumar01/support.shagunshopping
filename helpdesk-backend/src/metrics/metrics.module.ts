import { timingSafeEqual } from 'node:crypto';
import {
  CallHandler,
  Controller,
  ExecutionContext,
  Get,
  Global,
  Header,
  Injectable,
  Module,
  NestInterceptor,
  NotFoundException,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { DatabaseModule } from '../database/database.module.js';
import { MetricsService } from './metrics.service.js';

/** Times every HTTP request. The route label is the route pattern ("/tickets/:id"), never the real URL. */
@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const started = process.hrtime.bigint();
    const record = () => {
      const route =
        (request.route as { path?: string } | undefined)?.path ?? 'unmatched';
      const labels = {
        method: request.method,
        route,
        status: String(response.statusCode),
      };
      this.metrics.httpRequests.inc(labels);
      this.metrics.httpDuration.observe(
        labels,
        Number(process.hrtime.bigint() - started) / 1e9,
      );
    };
    return next.handle().pipe(tap({ next: record, error: record }));
  }
}

/** Disabled unless METRICS_TOKEN is set; then it needs that token as a Bearer credential. */
@Controller('api/v1/metrics')
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4')
  async scrape(@Req() request: Request) {
    const expected = this.config.get<string>('METRICS_TOKEN');
    if (!expected) throw new NotFoundException(); // looks like any other missing route
    const given = request.headers.authorization?.replace(/^Bearer /, '') ?? '';
    const a = Buffer.from(given);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b))
      throw new UnauthorizedException();
    return this.metrics.registry.metrics();
  }
}

@Global()
@Module({
  imports: [DatabaseModule],
  controllers: [MetricsController],
  providers: [
    MetricsService,
    { provide: APP_INTERCEPTOR, useClass: HttpMetricsInterceptor },
  ],
  exports: [MetricsService],
})
export class MetricsModule {}
