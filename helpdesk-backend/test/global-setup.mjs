import { migrate } from '../db/migrate.mjs';

// Runs once before all e2e tests: creates helpdesk_test if needed and applies every migration to it.
export default async function setup() {
  process.loadEnvFile('../.env');
  await migrate({ database: 'helpdesk_test', log: () => {} });
}
