# Real-Time Multi-Tenant Helpdesk SaaS

A production-style customer support and ticketing platform in the spirit of Zendesk and Freshdesk. Many client
organisations ("tenants") share one deployment, each with a fully isolated workspace. Customers raise tickets and
chat live with agents, agents leave private internal notes, and every organisation has an SLA whose breach triggers
automatic escalation and alerts.

**Built by Karan Kumar** as a deep, hands-on project in NestJS, PostgreSQL, Redis, Kafka and Docker.

---

## Table of contents

1. [What it does](#what-it-does)
2. [The problem it solves](#the-problem-it-solves)
3. [Who uses it](#who-uses-it)
4. [Feature tour](#feature-tour)
5. [Engineering highlights](#engineering-highlights)
6. [Architecture](#architecture)
7. [Tech stack and why](#tech-stack-and-why)
8. [Data model](#data-model)
9. [Security model](#security-model)
10. [Testing](#testing)
11. [Measured performance](#measured-performance)
12. [Project structure](#project-structure)
13. [Run it](#run-everything), [develop](#develop-with-the-apps-on-your-machine), [test](#tests-run-from-helpdesk-backend)
14. [Known limits](#known-limits-and-honest-notes)
15. [Resume summary](#resume-summary)

---

## What it does

Support teams need one place where customer problems are raised, tracked, discussed and resolved before a promised
deadline. This system provides that as a multi-tenant SaaS:

- A company signs up and gets its own **workspace** (an organisation) with an admin.
- The admin invites **agents** (support staff) and **customers**.
- Customers open **tickets** and talk to agents in a **live chat** on each ticket.
- Agents work a **queue** (search, filters, assignment, canned replies), add **internal notes** customers never see,
  and watch a **dashboard** of ticket counts and response times.
- Each organisation has an **SLA** (for example "first reply within 2 hours"). If it is missed, the ticket is flagged,
  escalated, and supervisors get a live red alert and an email, with no human having to notice.

## The problem it solves

| Pain in support teams | How this application addresses it |
|---|---|
| Requests arrive by email and get lost or duplicated | One ticket per issue with status, priority, owner and full history |
| Nobody knows who is handling what | Assignment, queue filters ("assigned to me", "unassigned"), live presence of online agents |
| Customers wait with no visibility | Live chat, instant status changes, email receipts, a portal showing only their own tickets |
| Deadlines are missed silently | SLA timers: automatic breach detection, priority escalation, alerts, audit trail |
| Staff need to discuss a case without the customer seeing | Private internal notes, enforced on the server, never sent to customer sockets |
| A vendor serving many companies must never leak data between them | Four independent layers of tenant isolation, including database Row-Level Security |
| Managers cannot see workload | Dashboard: status, priority, breached, unassigned, last-24-hour volume, average first-reply time |

## Who uses it

| Role | Can do |
|---|---|
| **Admin** | Everything an agent can, plus manage the team (invite, change roles) and read the email log |
| **Agent** | Work the queue, reply, write internal notes, assign tickets, change status, manage canned responses, see the dashboard |
| **Customer** | Raise tickets, chat on their own tickets; sees no internal notes and no staff email addresses |

Role checks in the UI only tidy the screen; the API guards are the real enforcement.

## Feature tour

**Accounts and access**
- Organisation onboarding: registering creates the tenant and its first admin atomically.
- Login with bcrypt-hashed passwords and signed JWTs; invitations by email; forgot-password and reset-by-email flow.
- Account page: change password, **sign out everywhere** (server-side session revocation), session-expiry notices.
- Role-based access control (Admin, Agent, Customer) through NestJS guards.

**Ticketing**
- Create, list (paginated), view and change status (Open, In progress, Resolved, Closed), with priority levels.
- Queue filters: status, priority, assignee, "SLA breached", subject search (with LIKE-escaping).
- Assignment with an audit trail; canned (saved) replies inserted from the reply box.
- Dashboard with counts by status and priority, unassigned work, and average first-response time.

**Live chat (WebSockets)**
- Customers and agents share a per-ticket room and see messages instantly, plus **typing indicators**.
- **Internal notes** go only to a staff-only room, never to the customer's room.
- Live status changes, "new ticket" pop-ups for staff, and **online-agent presence**.
- The page reconnects by itself after an API restart and keeps receiving messages.

**SLA engine**
- Deadline = ticket creation time + the organisation's SLA window.
- Redis sorted-set timers checked every 10 seconds; a breach raises priority one level, is audited, publishes
  `sla.breached`, shows a red live alert and emails supervisors.
- The first public staff reply, or resolving or closing the ticket, stops the clock.

**Event-driven back end**
- Ticket creation writes the ticket and its event in one transaction (transactional outbox); a relay publishes to
  Kafka-compatible Redpanda; independent consumers send receipts, write the audit log and register SLA timers.
- Retries with back-off, dead-letter topics, idempotent handlers, at-least-once delivery.

**Operations**
- Redis rate limiting (login, registration, invites, ticket and comment creation); health endpoint; private metrics;
  security headers; Docker health checks; backup script; CI pipeline; production compose file.

## Engineering highlights

These are the parts that go beyond CRUD, and the decisions behind them.

1. **Strict multi-tenant isolation, defence in depth.** The organisation id comes only from the verified token, never
   from a request body, parameter or query string. All tenant queries go through one data-access helper that takes
   the org id as `$1`. Foreign keys are composite `(id, org_id)` so a row cannot reference another tenant's row.
   PostgreSQL **Row-Level Security** (`app.current_org_id`, set per transaction) is the last line: the application
   connects as a restricted role (`helpdesk_app`) that cannot bypass it. Tests check that organisation A cannot read
   or change organisation B's data, and that one customer cannot see another customer's tickets.
2. **Plain SQL, no ORM.** Hand-written, versioned, checksummed migrations and parameterised queries, for full control
   of indexes, constraints, transactions and RLS policies.
3. **Transactional outbox for reliable events.** Publishing to Kafka inside the HTTP request would either slow the API
   or lose events on a crash. Writing the event in the same database transaction and relaying it afterwards means no
   lost events and no broker latency in the request. Two narrow `SECURITY DEFINER` functions let the relay read across
   tenants and nothing else does.
4. **Kafka consumers done properly.** Partition key = organisation id (per-tenant ordering), consumer groups per
   concern, bounded retries, dead-letter topics, idempotent handlers via unique keys, offsets committed after handling.
5. **Redis for what Redis is good at.** Presence (heartbeat sorted sets, so a crashed server leaves no ghost agents),
   rate limits, and the SLA sorted set (overdue lookups in O(log N + M) without polling Postgres). The database stays
   the authority on what is really overdue, so a stale timer cannot cause a false breach.
6. **Secure real-time.** Separate short-lived (60 s) socket-only tokens; token types are not interchangeable; the
   WebSocket handshake checks the Origin; every room name starts with the org id; joining a ticket room runs the same
   access rule as the REST API; sockets are dropped when the login session would have ended.
7. **The token never touches browser JavaScript.** The JWT lives in an httpOnly cookie set by the Next.js server, which
   calls the API on the browser's behalf, so the API needs no CORS.
8. **Scale-out ready.** A Redis adapter lets several API instances share Socket.io rooms; presence heartbeats and SLA
   checks are safe to run in duplicate.
9. **Quality gates.** Unit tests, integration tests against real Postgres, Redis, Kafka, SMTP and WebSockets, and a
   browser suite with automated accessibility checks, wired into CI.

## Architecture

```
Browser ── HTTPS ──> Next.js server ── REST + Bearer token ──> NestJS API ──> PostgreSQL (RLS)
   │  (httpOnly cookie holds the                                  │   │
   │   login token; the browser                                   │   ├─> outbox_events ──relay──> Redpanda ──> consumers:
   │   never sees it)                                             │   │        notifications (email + live alert)
   └──── WebSocket (60-second socket token) ──────────────────────┘   │        audit sink, SLA timers (Redis)
                                                                      └─> Redis: presence, SLA sorted set, rate limits
```

**Synchronous path:** the browser talks to Next.js; Next.js calls the NestJS API; a request completes when the row is
committed. **Asynchronous path:** the same transaction also stores an event; the relay publishes it and independent
consumers react (email receipt, live alert, audit entry, SLA timer registration) without slowing the request.

**SLA flow:** `ticket.created` goes to the SLA consumer, which adds `orgId:ticketId` to the Redis sorted set scored by
deadline. A check every 10 s runs `ZRANGEBYSCORE` for overdue entries, the database confirms, the ticket is flagged and
escalated, `sla.breached` is published, and supervisors get a red live alert and an email. A staff reply does `ZREM`.

## Tech stack and why

| Layer | Technology | Why |
|---|---|---|
| Frontend | Next.js 16 (App Router, Server Components, Server Actions), React 19, Tailwind CSS 4 | Server-rendered first paint, role-guarded views, forms through Server Actions, live updates through client hooks |
| API | NestJS (modular), TypeScript | Domain modules with controllers, services and guards; easy to split into services later |
| Database | PostgreSQL 17 with Row-Level Security | Relational data, constraints and ACID transactions |
| Data access | `pg` with hand-written SQL | Full control, and a deliberate SQL-skills choice |
| Real-time | Socket.io through a NestJS gateway, Redis adapter | Rooms, reconnection, scale-out |
| Events | Redpanda (Kafka protocol) via `@platformatic/kafka` | Kafka compatibility with far less memory than JVM Kafka plus Zookeeper |
| Cache / timers | Redis 7 | Presence, rate limiting, SLA sorted-set timers |
| Mail | Nodemailer over SMTP; Mailpit in development | A real SMTP path without sending real mail |
| Containers | Docker Compose, Node 24 multi-stage images, non-root, health checks | One command runs the whole system |
| Testing | Vitest, Playwright, axe-core | Unit, integration, browser and accessibility |
| CI/CD | GitHub Actions, Dependabot, Caddy for HTTPS in production | Repeatable checks and a documented deployment |

## Data model

Every tenant-scoped table has a mandatory `org_id`, composite indexes starting with `org_id`, an RLS policy and an
explicit least-privilege `GRANT` to the application role.

| Entity | Purpose |
|---|---|
| `organizations` | The tenant: slug, name, plan (FREE, PRO, ENT), SLA window in minutes |
| `users` | Email, bcrypt hash, role; unique per `(org_id, email)` |
| `tickets` | Subject, status, priority, requester, assignee, SLA deadline and breach flag, first-response time |
| `comments` | Message, author, `is_internal_note` flag |
| `audit_logs` | Append-only record of creation, status, assignment and SLA changes |
| `outbox_events` | Events waiting to be relayed to Kafka |
| `notifications` | Log of emails sent (visible to admins) |
| `canned_responses` | Saved replies per organisation |

Schema changes are versioned, numbered `.sql` files applied by `npm run db:migrate`. An applied migration is
checksummed and never edited; a change is a new migration.

## Security model

- Passwords hashed with bcrypt; JWTs with enforced expiry; server-side revocation ("sign out everywhere").
- Tenant isolation in four layers (token-derived org id, central query helper, composite foreign keys, Row-Level
  Security) with the app running as a non-owner database role.
- Role guards on every protected endpoint; customers get 404 (not 403) for other people's tickets, so ids cannot be probed.
- Internal notes never reach customer clients over REST or WebSocket; staff emails are hidden from customers.
- Rate limiting on sensitive endpoints, protective HTTP headers, private metrics, no framework fingerprinting.
- Secrets live only in a git-ignored `.env`; containers receive only the variables they need (the API never sees the owner database password).

## Testing

- **Unit tests** (Vitest) for guards, token verification and the session service; no services needed.
- **Backend integration tests** against real Postgres, Redis, Redpanda, Mailpit and WebSockets: tenancy and RLS,
  events and the outbox, SLA, presence, rate limits, real-time rooms, sessions and scale-out. Mutation-style checks
  confirmed that the important safety rules fail the tests when they are broken.
- **Browser tests** (Playwright, 52 tests) run against the full Docker stack: registration and login, role visibility,
  cross-tenant and cross-customer isolation, ticket flows, filters and pagination, live chat, a real SLA breach end to
  end, email through the outbox, Kafka and SMTP, phone-width layouts, security headers and **axe accessibility**
  checks. All 52 passed on the most recent run.

## Measured performance

Measured on one development laptop with everything in Docker and the load generator on the same machine, warm. These
are **not production numbers** and say nothing about a real network or a larger database.

| Request | p50 | p95 | p99 |
|---|---|---|---|
| POST /tickets, 1 client (n=250) | 7.2 ms | 10.5 ms | 22.3 ms |
| POST /tickets, 10 concurrent (n=500) | 22.5 ms | 36.4 ms | 63.1 ms |
| GET /tickets?limit=20 (about 800 tickets) | 4.3 ms | 7.5 ms | 10.0 ms |
| Chat message to the other user's socket, customer to agent (n=100) | 7.2 ms | 18.1 ms | 24.7 ms |
| Same, agent to customer (n=100) | 28.8 ms | 33.4 ms | 35.8 ms |

The design targets were ticket creation under 30 ms and chat under 100 ms. Both are met locally with a single client;
ticket creation is **not** under 30 ms at p95 with 10 concurrent clients.

## Project structure

```
helpdesk-backend/   NestJS API: auth, tickets, comments, realtime, events (outbox, relay, consumers), sla, presence,
                    rate-limit, mail, notifications, team, canned, health, metrics; db/migrations (numbered SQL)
helpdesk-frontend/  Next.js app: customer portal, agent queue, dashboard, ticket page with live chat, account, admin pages
e2e/                Playwright browser and accessibility tests
deploy/             Production compose override, Caddy (HTTPS) config, backup script
docs/DEPLOYMENT.md  Server deployment, backups, monitoring, troubleshooting
.github/            CI workflow and Dependabot
```

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

## Super admin (platform console)

The operator of the service has a separate **platform console** at `/platform`, above all organisations: see every
organisation, user and ticket (internal notes included, read-only), edit an organisation's name, plan and SLA, suspend or
reactivate it, and change a user's role or switch them off. Everything it changes, and every ticket it opens, is written
to an append-only audit log. Its login and token are separate from organisation logins (neither works in place of the
other), and a super admin can only be created from the server:

```bash
cd helpdesk-backend
npm run platform:create-admin -- you@example.com      # prints a generated password once
```

Database guide with diagram, readable `v_*` views and editing tips: [`docs/DATABASE.md`](docs/DATABASE.md).

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
publish to their own `test.*` Kafka topics. Browser tests live in `e2e/` (`npm install && npx playwright test`) and run
against a started Docker stack.

## Known limits and honest notes

- Not yet deployed to a public host; `docs/DEPLOYMENT.md` has not been run on a real internet-facing server.
- If Redis loses its data, running SLA timers are lost (AOF persistence is on; rebuilding them from the database is a possible next step).
- Event delivery is at-least-once, with per-tenant ordering only while the relay is healthy.
- No monitoring of Kafka consumer lag; dead-letter topics are not shown in the UI.
- `npm audit` reports findings in backend scaffold packages that have not been reviewed.
- Accessibility is checked automatically (axe) but not tested with screen readers.

More detail for contributors is in `CLAUDE.md` (design rules) and `PROGRESS.md` (what was built, decisions, limits).

## Resume summary

**Real-Time Multi-Tenant Helpdesk SaaS** | NestJS, Next.js, PostgreSQL, Redis, Kafka (Redpanda), Socket.io, Docker

- Designed and built a multi-tenant support platform (Zendesk/Freshdesk style) with a customer portal, agent queue,
  admin tools and dashboard, covering the path from tenant onboarding to ticket resolution.
- Enforced tenant isolation in four layers (token-derived org id, central query helper, composite foreign keys,
  PostgreSQL Row-Level Security with a restricted application role) and checked it with cross-tenant tests.
- Implemented real-time chat with Socket.io: tenant-scoped rooms, typing indicators, agent presence, private
  internal notes filtered server-side, a Redis adapter for scale-out, and automatic reconnection.
- Built an event-driven pipeline with a transactional outbox and Redpanda (Kafka): per-tenant partition keys,
  retries, dead-letter topics and idempotent consumers for notifications, audit and SLA tracking.
- Engineered an SLA engine on Redis sorted sets (10-second breach detection, automatic escalation, live alerts and
  email), with the database as the source of truth.
- Wrote the data layer in plain SQL with versioned migrations; added Redis rate limiting, token revocation and
  hardened security headers.
- Containerised the system with Docker Compose (health checks, non-root images), added GitHub Actions CI, and
  verified it with unit, integration and 52 Playwright browser tests including automated accessibility checks.
- Measured on a laptop: ticket creation p99 22 ms (single client), live message delivery p99 under 40 ms.
