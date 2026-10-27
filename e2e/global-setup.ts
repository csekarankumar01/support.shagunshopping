import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The stack's rate limits are real (login 10 a minute per account, 20 organisations an hour per address), so a
 * test run that signs up many organisations can run into them. Before a run, clear the counters in the stack's Redis.
 * Needs the docker CLI and the project's .env; skipped quietly otherwise (set E2E_RESET_RATE_LIMITS=0 to skip).
 */
export default function globalSetup() {
  if (process.env.E2E_RESET_RATE_LIMITS === '0') return;
  try {
    const env = readFileSync(path.resolve(import.meta.dirname, '..', '.env'), 'utf8');
    const password = /^REDIS_PASSWORD=(.*)$/m.exec(env)?.[1]?.trim();
    if (!password) return;
    const redis = (...args: string[]) =>
      execFileSync('docker', ['exec', 'helpdesk-redis', 'redis-cli', '-a', password, '--no-auth-warning', ...args], { encoding: 'utf8' }).trim();
    const keys = redis('--scan', '--pattern', 'rl:*').split(/\r?\n/).filter(Boolean);
    for (const key of keys) redis('DEL', key);
    console.log(`cleared ${keys.length} rate-limit counter(s)`);
  } catch {
    console.log('could not clear rate-limit counters (no docker or .env): continuing');
  }
}
