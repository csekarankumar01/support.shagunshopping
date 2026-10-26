import { TEST_DATABASE } from './test-database.js';

// Order matters: set the test database first. loadEnvFile never overrides variables that already exist,
// so POSTGRES_DB from .env cannot replace it.
process.env.POSTGRES_DB = TEST_DATABASE;
process.loadEnvFile('../.env');
