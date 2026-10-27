import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

/**
 * Removes the organisations the tests created (and everything that belongs to them) from the stack's database and
 * Redis, so repeated runs do not fill a development database with test data. Needs the docker CLI and the project's
 * .env; quietly does nothing otherwise (in CI the stack is thrown away anyway).
 */
export default function globalTeardown() {
  const listFile = path.resolve(import.meta.dirname, '.created-orgs.txt');
  if (!existsSync(listFile) || process.env.E2E_KEEP_DATA === '1') return;
  try {
    const slugs = [...new Set(readFileSync(listFile, 'utf8').split(/\r?\n/).filter((s) => /^[a-z0-9-]+$/.test(s)))];
    if (!slugs.length) return;
    const env = readFileSync(path.resolve(import.meta.dirname, '..', '.env'), 'utf8');
    const get = (name: string) => new RegExp(`^${name}=(.*)$`, 'm').exec(env)?.[1]?.trim() ?? '';
    const psql = (sql: string) =>
      execFileSync('docker', ['exec', 'helpdesk-postgres', 'psql', '-U', get('POSTGRES_USER'), '-d', get('POSTGRES_DB'), '-tAc', sql], { encoding: 'utf8' }).trim();
    const redis = (...args: string[]) =>
      execFileSync('docker', ['exec', 'helpdesk-redis', 'redis-cli', '-a', get('REDIS_PASSWORD'), '--no-auth-warning', ...args], { encoding: 'utf8' }).trim();
    const list = slugs.map((s) => `'${s}'`).join(',');
    const orgIds = psql(`select id from organizations where slug in (${list})`).split(/\r?\n/).filter(Boolean);
    const inIds = orgIds.map((id) => `'${id}'`).join(',');
    if (orgIds.length) {
      for (const member of redis('ZRANGE', 'sla:active_timers', '0', '-1').split(/\r?\n/).filter((m) => orgIds.some((id) => m.startsWith(id)))) {
        redis('ZREM', 'sla:active_timers', member);
      }
      for (const id of orgIds) redis('DEL', `presence:${id}`);
      // session_replication_role = replica switches off foreign-key checks, so children are deleted explicitly, in order.
      const tables = ['password_resets', 'refresh_tokens', 'notifications', 'outbox_events', 'canned_responses', 'dead_letters', 'audit_logs', 'comments', 'tickets', 'users'];
      psql(`begin; set local session_replication_role = replica; ${tables.map((t) => `delete from ${t} where org_id in (${inIds});`).join(' ')} delete from organizations where id in (${inIds}); commit;`);
    }
    rmSync(listFile);
    console.log(`removed ${orgIds.length} test organisation(s)`);
  } catch (error) {
    console.log(`could not remove the test organisations: ${String(error).slice(0, 160)}`);
  }
}
