import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

export type TenantQuery = <T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params?: unknown[],
) => Promise<QueryResult<T>>;

/**
 * Tripwire, not a guarantee: tenant SQL must mention org_id and use $1 (always the org id).
 * It catches a forgotten tenant filter early. The real guarantee is Row-Level Security in Postgres.
 */
export const assertTenantScoped = (sql: string) => {
  if (!/\borg_id\b/.test(sql) || !/\$1(?!\d)/.test(sql)) {
    throw new Error(
      'Tenant-scoped SQL must reference org_id and $1 (the org id)',
    );
  }
};

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private readonly pool: Pool;

  constructor(config: ConfigService) {
    // The app connects as a restricted role (not the owner), so Row-Level Security always applies to it.
    this.pool = new Pool({
      host: config.getOrThrow<string>('POSTGRES_HOST'),
      port: Number(config.getOrThrow<string>('POSTGRES_PORT')),
      database: config.getOrThrow<string>('POSTGRES_DB'),
      user: config.getOrThrow<string>('APP_DB_USER'),
      password: config.getOrThrow<string>('APP_DB_PASSWORD'),
    });
  }

  async onModuleInit() {
    const { rows } = await this.query<{ db: string }>(
      'SELECT current_database() AS db',
    );
    this.logger.log(`Connected to database "${rows[0].db}"`);
  }

  async onModuleDestroy() {
    await this.pool.end();
  }

  /**
   * Query with NO tenant context. Row-Level Security hides every tenant row from it, so use it only
   * for non-table work (health check) and the login lookup function. Tenant data goes through tenantQuery.
   */
  query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params: unknown[] = [],
  ) {
    return this.pool.query<T>(sql, params);
  }

  /** Tenant query: `orgId` is injected as $1; your own params start at $2. Runs with RLS context set. */
  tenantQuery<T extends QueryResultRow = QueryResultRow>(
    orgId: string,
    sql: string,
    params: unknown[] = [],
  ) {
    assertTenantScoped(sql); // fail before borrowing a connection
    return this.tenantTransaction(orgId, (query) => query<T>(sql, params));
  }

  /** Runs `work` on one dedicated connection inside BEGIN/COMMIT; any error rolls everything back. */
  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Transaction with the tenant context set for Row-Level Security.
   * `set_config(..., true)` is transaction-local, so it can never leak to the next user of a pooled connection.
   * Raw client: only for creating a brand-new tenant whose id was just generated (register-org).
   */
  tenantContextTransaction<T>(
    orgId: string,
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    return this.transaction(async (client) => {
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [
        orgId,
      ]);
      return work(client);
    });
  }

  /** Same as tenantContextTransaction(), but every statement is tenant-scoped like tenantQuery(). */
  tenantTransaction<T>(
    orgId: string,
    work: (query: TenantQuery) => Promise<T>,
  ): Promise<T> {
    return this.tenantContextTransaction(orgId, (client) =>
      work((sql, params = []) => {
        assertTenantScoped(sql);
        return client.query(sql, [orgId, ...params]);
      }),
    );
  }
}
