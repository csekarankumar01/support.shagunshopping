// Container entry point. With RUN_MIGRATIONS=true it first brings the database up to date (the same code as
// `npm run db:migrate`, safe to run from several instances at once thanks to an advisory lock), then starts the API.
// Without it, it just starts the API (docker-compose runs migrations as its own step).
//
// Why this exists: on a hosted platform the migration step must always happen before the API starts. A separate
// "pre-deploy command" is not available on every plan, and without it the restricted database role the API signs in
// as never gets created ("password authentication failed for user helpdesk_app").
//
// Trade-off: RUN_MIGRATIONS=true means the owner's database credentials (DATABASE_URL) are in the API's environment.
// The API itself never uses them (it signs in as the restricted role), but prefer a pre-deploy command where you can.
if (process.env.RUN_MIGRATIONS === 'true') {
  const { migrate } = await import('./migrate.mjs');
  try {
    await migrate();
  } catch (err) {
    console.error(`Migration failed, not starting the API: ${err.message}`);
    process.exit(1);
  }
}
await import('../dist/main.js');
