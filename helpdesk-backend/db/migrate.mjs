// Applies db/migrations/NNN_name.sql files in order and records each in schema_migrations.
//
//   npm run db:migrate                          migrate the database named in ../.env
//   npm run db:migrate -- --database my_db      migrate (and create, if missing) another database
//   npm run db:migrate -- --baseline 005_x.sql  mark every file up to that one as already applied
//                                               (for a database that was set up by hand before this runner existed)
//
// Each migration runs in one transaction together with its schema_migrations row, so it is
// applied completely or not at all. A migration that was already applied must never be edited:
// its checksum is stored and a changed file stops the run. Write a new migration instead.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';
import { ownerConnection, usesUrl } from './connection.mjs';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
const FILE_PATTERN = /^\d{3}_[a-z0-9_]+\.sql$/;
const LOCK_KEY = 727274; // arbitrary: stops two runners migrating the same database at once

async function ensureDatabase(name) {
  if (usesUrl()) return; // a hosted database named by DATABASE_URL already exists
  // A hosted database already exists (and its user usually cannot open the "postgres" maintenance database), so try
  // the target first and only create it when it is missing.
  const probe = new pg.Client(ownerConnection(name));
  try {
    await probe.connect();
    return;
  } catch (err) {
    if (err.code !== '3D000') throw err; // anything but "database does not exist" is a real problem
  } finally {
    await probe.end().catch(() => {});
  }
  const admin = new pg.Client(ownerConnection('postgres'));
  await admin.connect();
  try {
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (!rowCount) await admin.query(`CREATE DATABASE ${admin.escapeIdentifier(name)}`);
  } finally {
    await admin.end();
  }
}

/**
 * Migration 006 creates the restricted role the app connects as. On a hosted database the migrating user may not be
 * allowed to create roles; say so plainly, with the one command that fixes it, instead of failing inside a migration.
 */
async function ensureAppRole(client) {
  const { rowCount } = await client.query("SELECT 1 FROM pg_roles WHERE rolname = 'helpdesk_app'");
  if (rowCount) return;
  const { rows } = await client.query(
    'SELECT rolcreaterole OR rolsuper AS allowed FROM pg_roles WHERE rolname = current_user',
  );
  if (!rows[0]?.allowed) {
    throw new Error(
      'The database user may not create roles, and the role "helpdesk_app" does not exist yet. ' +
        'Ask whoever owns the database to run once:  CREATE ROLE helpdesk_app NOLOGIN;  ' +
        '(or use a Postgres host that allows CREATE ROLE), then run the migrations again.',
    );
  }
}

/** The app connects as a restricted role, not the owner. Its password lives in .env, never in SQL files. */
async function syncAppRolePassword(client, log) {
  const role = process.env.APP_DB_USER;
  const password = process.env.APP_DB_PASSWORD;
  if (!role || !password) return log('app role: APP_DB_USER/APP_DB_PASSWORD not set, skipped');
  const { rowCount } = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
  if (!rowCount) return log(`app role: "${role}" does not exist yet (created by migration 006), skipped`);
  await client.query(
    `ALTER ROLE ${client.escapeIdentifier(role)} WITH LOGIN PASSWORD ${client.escapeLiteral(password)}`,
  );
  log(`app role: password for "${role}" synced from .env`);
}

export async function migrate({ database = process.env.POSTGRES_DB, baseline, log = console.log } = {}) {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => FILE_PATTERN.test(f)).sort();
  await ensureDatabase(database);

  const client = new pg.Client(ownerConnection(database));
  await client.connect();
  const result = { database, applied: [], baselined: [] };
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await ensureAppRole(client);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      checksum   TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    const done = new Map(
      (await client.query('SELECT filename, checksum FROM schema_migrations')).rows.map((r) => [r.filename, r.checksum]),
    );

    for (const file of files) {
      // Normalise line endings so the checksum is the same on Windows (CRLF) and Linux/macOS (LF) checkouts.
      const raw = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8').replace(/\r\n/g, '\n');
      const checksum = createHash('sha256').update(raw).digest('hex');
      const record = `INSERT INTO schema_migrations (filename, checksum) VALUES (${client.escapeLiteral(file)}, '${checksum}')`;

      if (done.has(file)) {
        if (done.get(file) !== checksum) {
          throw new Error(`${file} was already applied but has been edited. Write a new migration instead.`);
        }
        continue;
      }
      if (baseline && file <= baseline) {
        await client.query(record);
        result.baselined.push(file);
        log(`baselined  ${file}`);
        continue;
      }
      // The runner owns the transaction, so drop any BEGIN;/COMMIT; lines the file carries itself.
      const body = raw.replace(/^\s*(BEGIN|COMMIT)\s*;\s*$/gim, '');
      try {
        await client.query(`BEGIN;\n${body}\n${record};\nCOMMIT;`);
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(`${file} failed and was rolled back: ${err.message}`);
      }
      result.applied.push(file);
      log(`applied    ${file}`);
    }
    if (!result.applied.length && !result.baselined.length) log(`"${database ?? "the database"}" is up to date`);
    await syncAppRolePassword(client, log);
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    await client.end();
  }
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const arg = (name) => {
    const i = process.argv.indexOf(`--${name}`);
    return i === -1 ? undefined : process.argv[i + 1];
  };
  migrate({ database: arg('database') ?? process.env.POSTGRES_DB, baseline: arg('baseline') }).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
