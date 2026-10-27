# Help desk API (NestJS)

The backend of the help desk: REST API, live chat over WebSocket, the event pipeline (outbox, Kafka consumers) and
the SLA engine. The whole-system overview, how to run everything and how to deploy are in the
[project README](../README.md) and [`docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md); the design rules are in
[`CLAUDE.md`](../CLAUDE.md).

## Run it

```bash
docker compose up -d postgres redis redpanda mailpit     # from the project root
npm install
npm run db:migrate        # applies db/migrations/*.sql to the database named in ../.env
npm run start:dev         # http://localhost:4310
```

## Commands

| Command | What it does |
|---|---|
| `npm run build` / `npm run lint` | compile / lint (oxlint) |
| `npm test` | unit tests, no services needed |
| `npm run test:e2e` | end-to-end tests against real Postgres, Redis, Redpanda, Mailpit and WebSockets (builds its own `helpdesk_test` database; one file at a time) |
| `npm run db:migrate` | apply pending migrations (`-- --database NAME` for another database; never edit an applied migration, add a new one) |

## Layout (`src/`)

| Folder | Purpose |
|---|---|
| `auth/` | login, rotating refresh tokens, sessions and revocation, password flows, invitations, guards (`verify-token.ts` is the one place tokens are checked) |
| `tickets/`, `comments/` | the core domain; every query goes through `DatabaseService.tenantQuery` / `tenantTransaction` |
| `realtime/` | the Socket.io gateway, rooms, the Redis adapter |
| `presence/` | who is online (Redis, correct across instances) |
| `events/` | transactional outbox relay, Kafka client, the notification and audit consumers |
| `sla/` | SLA timers (Redis sorted set), breach checks, recovery from the database |
| `team/`, `canned/`, `notifications/` | member management, canned responses, the email log |
| `rate-limit/`, `metrics/`, `health/`, `mail/`, `redis/`, `database/` | infrastructure |

Database access is plain SQL with the `pg` driver (no ORM). The application connects as the restricted role
`helpdesk_app`, never as the owner, so PostgreSQL Row-Level Security always applies.

## Configuration

Read from the environment (and `../.env` in development). The complete list with comments is in
[`../.env.example`](../.env.example). The ones you are most likely to change: `PORT`, `JWT_EXPIRES_IN_SECONDS`,
`FRONTEND_ORIGIN`, `ALLOW_REGISTRATION`, `METRICS_TOKEN`, `SMTP_*`, `TRUST_PROXY`.
