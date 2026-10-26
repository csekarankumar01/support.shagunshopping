import { TEST_DATABASE } from './test-database.js';

// Order matters: set the test database first. loadEnvFile never overrides variables that already exist,
// so POSTGRES_DB from .env cannot replace it.
process.env.POSTGRES_DB = TEST_DATABASE;
// Kafka consumers, the outbox relay and the SLA timer stay off unless a test file turns them on (events.e2e-spec.ts),
// so unrelated tests neither depend on the broker nor consume each other's events.
process.env.EVENTS_ENABLED = 'false';
process.env.REDIS_KEY_PREFIX = 'test:'; // tests get their own Redis keys, never the real ones
process.env.KAFKA_TOPIC_PREFIX = 'test.'; // tests get their own Kafka topics, never the real ones
// Rate limits are on in production and off here (the tests log in hundreds of times); rate-limit.e2e-spec.ts turns them on.
process.env.RATE_LIMIT_DISABLED = 'true';
process.loadEnvFile('../.env');
