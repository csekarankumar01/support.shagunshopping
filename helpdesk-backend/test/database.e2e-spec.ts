import { INestApplication } from '@nestjs/common';
import pg from 'pg';
import { DatabaseService } from '../src/database/database.service.js';
import {
  appRoleClient,
  auth,
  createTenant,
  createTestApp,
  deleteTenants,
  http,
  ownerPool,
  Tenant,
} from './helpers.js';

const API = '/api/v1';

/** Runs `work` as the restricted app role with the tenant context set, like the running app does. */
async function asTenant<T>(
  orgId: string | null,
  work: (c: pg.Client) => Promise<T>,
): Promise<T> {
  const client = appRoleClient();
  await client.connect();
  try {
    await client.query('BEGIN');
    if (orgId)
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [
        orgId,
      ]);
    return await work(client);
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    await client.end();
  }
}

describe('database safety nets (below the application code)', () => {
  let app: INestApplication;
  let owner: pg.Pool;
  let a: Tenant;
  let b: Tenant;
  let ticketA: string;
  let ticketB: string;
  let custBUserId: string;
  const slugs: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    owner = ownerPool();
    a = await createTenant(app, 'dba');
    b = await createTenant(app, 'dbb');
    slugs.push(a.slug, b.slug);
    const mk = async (token: string, subject: string) =>
      (
        await http(app)
          .post(`${API}/tickets`)
          .set(auth(token))
          .send({ subject })
      ).body.id as string;
    ticketA = await mk(a.cust1, 'DB A ticket');
    ticketB = await mk(b.cust1, 'DB B ticket');
    custBUserId = (await http(app).get(`${API}/auth/me`).set(auth(b.cust1)))
      .body.userId;
    // one audit row so there is something to try to tamper with
    await http(app)
      .patch(`${API}/tickets/${ticketA}/status`)
      .set(auth(a.agent))
      .send({ status: 'RESOLVED' });
  });

  afterAll(async () => {
    await deleteTenants(owner, slugs);
    await owner.end();
    await app.close();
  });

  describe('composite foreign keys', () => {
    it('reject a comment whose org differs from its ticket', async () => {
      const author = (await http(app).get(`${API}/auth/me`).set(auth(a.cust1)))
        .body.userId;
      await expect(
        owner.query(
          "INSERT INTO comments (ticket_id, org_id, author_id, message) VALUES ($1, $2, $3, 'sneaky')",
          [ticketA, b.orgId, author],
        ),
      ).rejects.toThrow(/foreign key/i);
    });

    it("reject assigning another organisation's agent to a ticket", async () => {
      const agentB = (await http(app).get(`${API}/auth/me`).set(auth(b.agent)))
        .body.userId;
      await expect(
        owner.query('UPDATE tickets SET agent_id = $1 WHERE id = $2', [
          agentB,
          ticketA,
        ]),
      ).rejects.toThrow(/foreign key/i);
    });
  });

  describe('audit_logs is append-only', () => {
    it('blocks UPDATE and DELETE even for the database owner (trigger)', async () => {
      await expect(
        owner.query(
          "UPDATE audit_logs SET new_val = 'HACKED' WHERE ticket_id = $1",
          [ticketA],
        ),
      ).rejects.toThrow(/append-only/);
      await expect(
        owner.query('DELETE FROM audit_logs WHERE ticket_id = $1', [ticketA]),
      ).rejects.toThrow(/append-only/);
    });

    it('is also closed to the app role by privileges (no UPDATE or DELETE granted)', async () => {
      await asTenant(a.orgId, async (c) => {
        await expect(
          c.query("UPDATE audit_logs SET new_val = 'x'"),
        ).rejects.toThrow(/permission denied/);
      });
      await asTenant(a.orgId, async (c) => {
        await expect(c.query('DELETE FROM audit_logs')).rejects.toThrow(
          /permission denied/,
        );
      });
    });
  });

  describe('Row-Level Security, as the restricted app role', () => {
    it('shows no rows at all when no tenant context is set', async () => {
      await asTenant(null, async (c) => {
        for (const table of [
          'organizations',
          'users',
          'tickets',
          'comments',
          'audit_logs',
        ]) {
          const { rows } = await c.query(
            `SELECT count(*)::int AS n FROM ${table}`,
          );
          expect(rows[0].n, table).toBe(0);
        }
      });
    });

    it('shows a tenant only its own rows, even with a query that has NO WHERE clause', async () => {
      await asTenant(a.orgId, async (c) => {
        const { rows } = await c.query('SELECT DISTINCT org_id FROM tickets');
        expect(rows).toEqual([{ org_id: a.orgId }]);
      });
    });

    it("hides another tenant's rows even when the query asks for them by id", async () => {
      await asTenant(a.orgId, async (c) => {
        expect(
          (await c.query('SELECT * FROM tickets WHERE id = $1', [ticketB]))
            .rowCount,
        ).toBe(0);
        expect(
          (await c.query('SELECT * FROM tickets WHERE org_id = $1', [b.orgId]))
            .rowCount,
        ).toBe(0);
        expect(
          (await c.query('SELECT * FROM users WHERE org_id = $1', [b.orgId]))
            .rowCount,
        ).toBe(0);
      });
    });

    it('refuses to insert a row for another tenant', async () => {
      await asTenant(a.orgId, async (c) => {
        await expect(
          c.query(
            "INSERT INTO tickets (org_id, requester_id, subject, sla_deadline) VALUES ($1, $2, 'planted', now())",
            [b.orgId, custBUserId],
          ),
        ).rejects.toThrow(/row-level security/i);
      });
    });

    it("cannot update another tenant's row (0 rows affected, data unchanged)", async () => {
      await asTenant(a.orgId, async (c) => {
        const res = await c.query(
          "UPDATE tickets SET subject = 'defaced' WHERE id = $1",
          [ticketB],
        );
        expect(res.rowCount).toBe(0);
      });
      const { rows } = await owner.query(
        'SELECT subject FROM tickets WHERE id = $1',
        [ticketB],
      );
      expect(rows[0].subject).toBe('DB B ticket');
    });

    it('does not leak the tenant context to the next transaction on the same connection', async () => {
      const client = appRoleClient();
      await client.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          "SELECT set_config('app.current_org_id', $1, true)",
          [a.orgId],
        );
        expect(
          (await client.query('SELECT count(*)::int AS n FROM tickets')).rows[0]
            .n,
        ).toBeGreaterThan(0);
        await client.query('COMMIT');
        expect(
          (await client.query('SELECT count(*)::int AS n FROM tickets')).rows[0]
            .n,
        ).toBe(0);
      } finally {
        await client.end();
      }
    });

    it('catches a tenant query that passes the org_id tripwire but forgets the real filter', async () => {
      const db = app.get(DatabaseService);
      // Mentions org_id and $1 (so the tripwire is satisfied) yet filters nothing: a realistic mistake.
      const { rows } = await db.tenantQuery<{ org_id: string }>(
        a.orgId,
        'SELECT org_id FROM tickets WHERE $1::uuid IS NOT NULL',
      );
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.org_id === a.orgId)).toBe(true);
    });
  });

  describe('app role privileges and the login lookup', () => {
    it('cannot read the migration bookkeeping table', async () => {
      await asTenant(a.orgId, async (c) => {
        await expect(
          c.query('SELECT * FROM schema_migrations'),
        ).rejects.toThrow(/permission denied/);
      });
    });

    it('cannot delete tickets (no DELETE privilege yet)', async () => {
      await asTenant(a.orgId, async (c) => {
        await expect(
          c.query('DELETE FROM tickets WHERE id = $1', [ticketA]),
        ).rejects.toThrow(/permission denied/);
      });
    });

    it('auth_lookup_user returns exactly one user for an exact org+email pair, with no tenant context', async () => {
      await asTenant(null, async (c) => {
        const hit = await c.query('SELECT * FROM auth_lookup_user($1, $2)', [
          a.slug,
          'agent@x.com',
        ]);
        expect(hit.rowCount).toBe(1);
        expect(hit.rows[0].org_id).toBe(a.orgId);
        const wrongOrg = await c.query(
          'SELECT * FROM auth_lookup_user($1, $2)',
          [b.slug, 'ghost@x.com'],
        );
        expect(wrongOrg.rowCount).toBe(0);
        // an email that exists in A is not found when looked up under B's slug only if it is absent there
        const crossed = await c.query(
          'SELECT * FROM auth_lookup_user($1, $2)',
          ['no-such-org', 'agent@x.com'],
        );
        expect(crossed.rowCount).toBe(0);
      });
    });
  });
});
