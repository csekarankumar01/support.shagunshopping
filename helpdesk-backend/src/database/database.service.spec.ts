import { ConfigService } from '@nestjs/config';
import { assertTenantScoped, DatabaseService } from './database.service.js';

describe('assertTenantScoped (the tripwire)', () => {
  it('accepts SQL that filters by org_id = $1', () => {
    expect(() =>
      assertTenantScoped('SELECT * FROM tickets WHERE org_id = $1'),
    ).not.toThrow();
  });

  it('accepts an INSERT that writes org_id from $1', () => {
    expect(() =>
      assertTenantScoped('INSERT INTO users (org_id, email) VALUES ($1, $2)'),
    ).not.toThrow();
  });

  it('rejects SQL that never mentions org_id', () => {
    expect(() =>
      assertTenantScoped('SELECT * FROM tickets WHERE id = $2'),
    ).toThrow(/org_id/);
  });

  it('rejects SQL that mentions org_id but never uses $1', () => {
    expect(() =>
      assertTenantScoped('SELECT * FROM tickets WHERE org_id = $2'),
    ).toThrow(/\$1/);
  });

  it('does not mistake $10 for $1', () => {
    expect(() =>
      assertTenantScoped('SELECT org_id FROM tickets WHERE a = $10'),
    ).toThrow();
  });
});

describe('DatabaseService tenant queries', () => {
  const calls: { sql: string; params?: unknown[] }[] = [];

  const makeService = () => {
    calls.length = 0;
    const config = {
      getOrThrow: (key: string) => (key === 'POSTGRES_PORT' ? '5432' : 'x'),
    } as unknown as ConfigService;
    const service = new DatabaseService(config);
    const client = {
      query: async (sql: string, params?: unknown[]) => {
        calls.push({ sql, params });
        return { rows: [], rowCount: 0 };
      },
      release: () => {},
    };
    (service as unknown as { pool: unknown }).pool = {
      connect: async () => client,
      query: client.query,
    };
    return service;
  };

  it('sets the tenant context before the query, inside a transaction, with orgId as $1', async () => {
    const service = makeService();
    await service.tenantQuery(
      'org-123',
      'SELECT * FROM tickets WHERE org_id = $1 AND id = $2',
      ['t-1'],
    );

    expect(calls.map((c) => c.sql)).toEqual([
      'BEGIN',
      "SELECT set_config('app.current_org_id', $1, true)",
      'SELECT * FROM tickets WHERE org_id = $1 AND id = $2',
      'COMMIT',
    ]);
    expect(calls[1].params).toEqual(['org-123']);
    expect(calls[2].params).toEqual(['org-123', 't-1']);
  });

  it('rolls back and rethrows when the query fails', async () => {
    const service = makeService();
    const failing = (
      service as unknown as {
        pool: {
          connect: () => Promise<{ query: (s: string) => Promise<unknown> }>;
        };
      }
    ).pool;
    const client = await failing.connect();
    const original = client.query;
    client.query = async (sql: string) => {
      if (sql.startsWith('SELECT * FROM tickets')) throw new Error('boom');
      return original(sql);
    };
    await expect(
      service.tenantQuery('org-123', 'SELECT * FROM tickets WHERE org_id = $1'),
    ).rejects.toThrow('boom');
    expect(calls.map((c) => c.sql)).toContain('ROLLBACK');
    expect(calls.map((c) => c.sql)).not.toContain('COMMIT');
  });

  it('refuses unscoped SQL before touching the database', async () => {
    const service = makeService();
    // tenantQuery throws synchronously, before a connection is even borrowed
    expect(() =>
      service.tenantQuery('org-123', 'SELECT * FROM tickets'),
    ).toThrow(/org_id/);
    expect(calls).toHaveLength(0);
  });

  it('also refuses unscoped SQL inside a tenant transaction, and rolls back', async () => {
    const service = makeService();
    await expect(
      service.tenantTransaction('org-123', (query) =>
        query('SELECT * FROM tickets'),
      ),
    ).rejects.toThrow(/org_id/);
    expect(calls.map((c) => c.sql)).toEqual([
      'BEGIN',
      "SELECT set_config('app.current_org_id', $1, true)",
      'ROLLBACK',
    ]);
  });
});
