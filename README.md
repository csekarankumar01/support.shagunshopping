# Real-Time Multi-Tenant Helpdesk SaaS

A customer-support and ticketing platform in the style of Zendesk or Freshdesk. Many organisations ("tenants")
share one deployment, each with an isolated workspace. Customers raise tickets and chat live with agents; agents
can leave private internal notes; every organisation has an SLA whose breach raises automatic alerts.

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 (App Router, Server Components, Server Actions), React 19, Tailwind 4 |
| API | NestJS 12, plain SQL with `pg` (no ORM), Socket.io for live chat |
| Data | PostgreSQL 17 with Row-Level Security, Redis 7 (presence, SLA timers, rate limits) |
| Events | Redpanda (Kafka-compatible) through a transactional outbox |
| Mail | Real SMTP; Mailpit catches it in development |
| Runtime | Docker Compose (Node 24) |

## Run everything

```bash
cp .env.example .env        # then replace every "change-me" (use long random values)
docker compose up -d --build
```

Open **http://localhost:4311**, choose "Create one" to register your organisation (you become its admin), then invite
agents and customers from the **Team** page. Look at the emails the system sends at **http://localhost:4026** (Mailpit).

| What | Where |
|---|---|
| Web app | http://localhost:4311 |
| API | http://localhost:4310 (health: `/api/v1/health`) |
| Mail inbox (dev) | http://localhost:4026 |
| Postgres / Redis / Kafka | `localhost:5432` / `4379` / `4092` |

Ports 1338, 1339, 3000, 3001, 8000 and 8080 are used by other projects on the development machine and are avoided.
Stop the containers before running the apps from your editor (they share ports 4310 and 4311).

## Develop with the apps on your machine

```bash
docker compose up -d postgres redis redpanda mailpit
cd helpdesk-backend  && npm install && npm run db:migrate && npm run start:dev   # API on 4310
cd helpdesk-frontend && npm install && npm run dev                                # web on 4311
```

## Tests (run from `helpdesk-backend/`)

```bash
npm test          # unit tests, no services needed
npm run test:e2e  # end-to-end: needs the four services above; builds its own helpdesk_test database
npm run test:all
```

The end-to-end tests exercise the real database, Redis, Kafka, SMTP and WebSockets. They run one file at a time and
publish to their own `test.*` Kafka topics.

## How it fits together

```
Browser ── HTTPS ──> Next.js server ── REST + Bearer token ──> NestJS API ──> PostgreSQL (RLS)
   │  (httpOnly cookie holds the                                  │   │
   │   login token; the browser                                   │   ├─> outbox_events ──relay──> Redpanda ──> consumers:
   │   never sees it)                                             │   │        notifications (email + live alert)
   └──── WebSocket (60-second socket token) ──────────────────────┘   │        audit sink, SLA timers (Redis)
                                                                      └─> Redis: presence, SLA sorted set, rate limits
```

- **Tenant isolation, four layers:** the organisation id comes only from the verified token; every query goes through
  one helper that puts it in `$1`; foreign keys include the org id; and PostgreSQL Row-Level Security hides other
  tenants' rows from the application's database role.
- **Events:** a ticket and its `ticket.created` event are written in one transaction. A relay publishes to Kafka,
  keyed by organisation so one tenant's events stay ordered. Consumers retry, dead-letter, and are idempotent.
- **SLA:** each ticket's deadline sits in a Redis sorted set; a check every 10 seconds finds overdue ones, flags the
  ticket, raises its priority and alerts supervisors. A public staff reply or resolving the ticket stops the clock.

More detail for contributors is in `CLAUDE.md` (design rules) and `PROGRESS.md` (what was built, decisions, limits).
