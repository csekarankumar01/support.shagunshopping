# Project: Real-Time Multi-Tenant Helpdesk SaaS

Developer: Karan Kumar. Senior reviewer: Tarun Bidaliya.
This file is the single source of truth for the project. Read it fully at the start of every session.

---

## 1. Status

- Planning is complete. The backend lives in `helpdesk-backend/` and the frontend in `helpdesk-frontend/`, both inside the project root; Postgres runs from the root `docker-compose.yml`.
- **All ten plan steps are built and tested** (see `PROGRESS.md`; Steps 7 to 10 were built in one autonomous pass). `docker compose up -d --build` runs the whole system; `README.md` explains running and developing it.
- **Ports (developer's instruction; other projects use the old ones):** API `4310`, Next.js `4311`, Postgres `5432`. Do not use 3000, 3001, 1338, 1339 or 8000. Pick new ports from the 43xx range and check they are free first.
- Keep `PROGRESS.md` up to date (see section 12).

---

## 2. Purpose and vision

A production-style, multi-tenant customer support and ticketing platform, modelled on Zendesk and Freshdesk.

- Multiple client organisations ("tenants") each get an isolated workspace.
- Customers raise tickets and converse with agents through live chat.
- Agents can leave **private internal notes** that customers never see.
- Each organisation has an **SLA** (for example, "respond within 2 hours"). A missed deadline triggers automated alerts.

It is intentionally more than a CRUD app. It tackles three things:

1. **Strict multi-tenant data isolation** with role-based access control.
2. **Real-time state synchronisation** (live chat and status updates over WebSockets).
3. **Event-driven background processing** (Kafka decouples ticket creation from notifications, SLA checks and dashboard updates).

The developer is building this to learn NestJS, Docker and Kafka in practice, and to be able to explain the design in interviews and to the senior reviewer.

---

## 3. Tech stack

| Layer | Choice | Role |
|---|---|---|
| Frontend | Next.js (App Router, TypeScript, Tailwind) | Role-guarded views: Customer Portal (submit and follow tickets) and Agent Queue. Server Components for initial loads, client hooks for live WebSocket updates |
| Backend | NestJS (modular) | Domain modules: Auth, Org, Tickets, Comments, Notification. Controllers handle requests, services hold the logic. Structure that makes later extraction into microservices straightforward |
| Database | PostgreSQL | Relational hierarchy (orgs, users, tickets, comments, audit logs) benefits from joins, constraints and ACID transactions. Chosen over MongoDB for this reason |
| Real-time | Socket.io via NestJS WebSocket Gateway | Live ticket chat, typing indicators, status broadcasts, scoped to tenant rooms |
| Event bus | Apache Kafka protocol, **Redpanda** in Docker (decided, section 13) via `@platformatic/kafka` | Decouples ticket creation from notifications, SLA registration and audit. Events go through a transactional outbox (`outbox_events`, relay in `src/events/`) |
| Cache / timers | Redis | Online agent presence, API rate limiting, sorted-set SLA timers |
| Data access | `pg` driver, plain SQL (no ORM) | Developer's decision: write SQL by hand to build SQL skills. Tenant queries go through `DatabaseService.tenantQuery` / `tenantTransaction` (org id is always `$1`, RLS context is set per transaction). The app connects as the restricted role `helpdesk_app`, not the owner. Schema lives in numbered `.sql` files applied by `npm run db:migrate` |
| Containers | Docker Compose | Postgres, Redis, Redpanda, Mailpit (dev mail catcher), a one-shot `migrate`, the API and the web app. Both app images use Node 24 |

Package manager: npm. Language: TypeScript. Library versions are not pinned in the plan, so **ask before choosing major versions**.

---

## 4. Architecture

**Synchronous path:** Next.js client talks to the NestJS API over REST/HTTPS and to the Socket.io gateway over WSS. NestJS reads and writes PostgreSQL. A request completes when the row is committed.

**Asynchronous path:** after the write, NestJS publishes a domain event to Kafka. Independent consumers react:
- Notification consumer (customer receipt, WebSocket badge update)
- SLA timer consumer (registers deadlines in Redis)
- Audit and metrics sink

Redis holds presence, rate limits and SLA timers. Postgres is the source of truth.

Why events: sending email, scheduling SLA timers and writing audit entries inside the HTTP request would slow the API and create single points of failure. Publishing events lets consumers process downstream work with retries.

Targets from the plan (**goals to measure, not measured results**): HTTP ticket creation returning in under 30 ms; sub-100 ms live chat. Never describe these as achieved without measuring.

---

## 5. Data model

Every tenant-scoped entity has a **mandatory `org_id` foreign key**, backed by composite indexes starting with `org_id` so tenant queries do not scan the full table.

| Entity | Keys | Attributes | Rules |
|---|---|---|---|
| Organization | id (UUID PK), slug | name, plan (FREE, PRO, ENT), sla_mins | Root tenant record. Defines the default SLA window |
| User | id (PK), org_id (FK) | email, password_hash, role (ADMIN, AGENT, CUSTOMER), is_online | Unique (org_id, email). Role checked by RBAC guards |
| Ticket | id (PK), org_id (FK) | subject, status, priority, requester_id, agent_id, sla_deadline | Composite index (org_id, status, priority) for queues. `requester_id` added in Step 5 so customers only see their own tickets. Composite FKs `(requester_id, org_id)` and `(agent_id, org_id)` to users |
| Comment | id (PK), ticket_id, org_id | author_id, message, is_internal_note (bool) | Internal notes hidden from customer clients |
| AuditLog | id (PK), org_id (FK) | ticket_id, actor_id, action, old_val, new_val | Append-only record of status and assignment changes |

Notes:
- Step 2 starts with a simple `User` entity. The per-organisation `org_id` and `Unique (org_id, email)` rule arrive in Step 4 when Organization is added.
- No ORM (decision replaces TypeORM, so `synchronize: true` does not apply). Tables are created by hand-written, numbered `.sql` migration files. Explain to the developer why schema changes are versioned.

---

## 6. Multi-tenancy and isolation (most important part)

Approach: **shared database, shared schema**, with isolation enforced automatically at the framework layer rather than by manual filters in each controller.

1. **Stateless JWT context.** The signed token carries `{ sub: userId, orgId: tenantUuid, role }`, set at login.
2. **NestJS guard / interceptor.** Extracts `orgId` from the verified JWT and binds it to the request context before any controller or service runs, so a query cannot leak another organisation's data.
3. **Query auto-scoping.** With no ORM, all tenant-scoped queries go through one central data-access helper that requires the `orgId` argument and puts it in the `WHERE`. A forgotten `org_id` filter is the main leak risk, so review every new query for it.
4. **PostgreSQL Row-Level Security** (`app.current_org_id`) as a database-level fail-safe.

Rules to follow whenever writing code:
- The org id always comes from the verified token, **never from the request body, params or query string**.
- Every new tenant-scoped endpoint must be checked for cross-tenant access.
- **Row-Level Security is enabled** (migration 008), at the developer's request on 2026-10-26. It only protects anything because the app connects as `helpdesk_app`; superusers and owners bypass RLS, so never point the app at the `helpdesk` owner account.
- **Every new tenant table needs three things in its migration:** an `org_id` column, `ENABLE ROW LEVEL SECURITY` plus a `tenant_isolation` policy, and a `GRANT` to `helpdesk_app` (least privilege; no DELETE unless needed). Without the GRANT the app cannot use it.
- The one cross-tenant read is the `auth_lookup_user()` function used by login. Do not add more `SECURITY DEFINER` functions without a clear reason. (The only other ones are `outbox_claim` and `outbox_complete`: the event relay must read every tenant's outbox rows.)

### Commands (run from `helpdesk-backend/`)
- `npm run db:migrate` applies pending migrations to the database in `../.env`. `npm run db:migrate -- --database NAME` targets another database. Never edit a migration that has been applied (its checksum is stored); add a new one.
- `npm test` runs unit tests (no database). `npm run test:e2e` runs end-to-end tests against the separate `helpdesk_test` database, which it builds and migrates itself. `npm run test:all` runs both.
- `.env` needs `POSTGRES_*` (owner, used only by migrations and test cleanup), `APP_DB_USER`/`APP_DB_PASSWORD` (what the app uses), `JWT_SECRET`, `JWT_EXPIRES_IN_SECONDS`, `PORT`. See `.env.example`.

### Whole system
- `docker compose up -d --build` runs everything (web 4311, API 4310, Mailpit inbox 4026). `docker compose up -d postgres redis redpanda mailpit` starts only the services, for running the apps from the editor. Never run both: they share ports 4310 and 4311.
- `npm run test:e2e` needs Postgres, Redis, Redpanda and Mailpit running. E2E files run one at a time and use `test.*` Kafka topics; keep it that way (the real relay and consumers process any organisation's events).

### Frontend (`helpdesk-frontend/`, run from that folder)
- `npm run dev` (or `npm run build` then `npm run start`) serves on port 4311. `npm run lint` checks it. It finds the API through `API_URL` (default `http://localhost:4310`).
- **Token rule:** the JWT lives only in an httpOnly cookie set by the Next server. The browser never receives it and never calls the API directly, so the API needs no CORS. Keep it that way; do not put the token in `localStorage` or in client components. (The one exception is the Socket.io connection, which the browser opens to the API directly. It uses a separate 60-second socket-only token from `/api/socket-token`, and the API checks the handshake's Origin against `FRONTEND_ORIGIN`.)
- **Every form's submit button must be a `SubmitButton`** (disabled until hydrated). With `cacheComponents`, Next 16.4.3 answers a plain no-JavaScript form post without the page shell, which shows a blank page. Timestamps use `<LocalTime>`; long user text needs `overflow-wrap:anywhere` so phones don't scroll sideways.
- Comments from the API carry `authorRole` always and `authorEmail` only for staff viewers or the author. Do not expose staff emails to customers.
- **Tokens are not interchangeable** (`src/auth/verify-token.ts` is the one place tokens are checked): the REST API refuses a socket token, the WebSocket refuses a login token, and a token with no expiry is refused. A socket is dropped when the login session it came from would have ended.
- **Rooms** (`src/realtime/events.ts`) always start with the org id. Internal notes go to the ticket's staff-only room and never to the room a customer joins; customers get staff authors without their email. Anyone joining a ticket room passes `canAccessTicket` (`src/tickets/ticket-access.ts`), the same rule as the REST API. Do not copy that SQL elsewhere.
- Role checks in the frontend only tidy the UI. The backend guards are the real enforcement.
- `cacheComponents` is on: any component that reads `cookies()` or `searchParams`/`params` must sit inside `<Suspense>`.
- Next.js 16 differs from older tutorials; read the docs in `helpdesk-frontend/node_modules/next/dist/docs/` before using an API from memory.

---

## 7. Roles

- **ADMIN:** organisation-level control.
- **AGENT:** works the ticket queue, replies, adds internal notes.
- **CUSTOMER:** creates tickets and sees only what is meant for customers (no internal notes).

Enforced by role-based guards (RBAC).

---

## 8. API surface

| Module | Base path | Endpoints |
|---|---|---|
| AuthModule | /api/v1/auth | POST /register-org (atomic tenant + admin creation), POST /login (issues JWT), POST /invite, POST /socket-token (60-second WebSocket-only token, added in Step 7) |
| TicketsModule | /api/v1/tickets | GET / (paginated tenant queue), GET /:id (added in Step 6 for the detail page), POST / (saves ticket and emits `ticket.created`), PATCH /:id/status |
| Other modules (added in Steps 7 to 10) | /api/v1/... | `GET /presence` (staff), `GET /team` (staff; admins see customers too), `/canned-responses` CRUD (staff), `GET /notifications` (admin email log), `GET /health` (no login), tickets also have `GET /stats` (staff), `PATCH /:id/assign` (staff) |
| CommentsModule | /api/v1/tickets/:id/comments | GET / (strips internal notes for customers), POST / (saves and broadcasts over WebSocket) |
| SupportGateway (`src/realtime/`) | wss://.../support (Socket.io namespace `support`, WebSocket transport only) | Handshake needs a socket token and an allowed Origin. Events in: `ticket:join`, `ticket:leave`, `typing`. Events out: `comment:new`, `ticket:status`, `typing`, `session:expired`. Messages are written through the REST endpoints, which then publish |

---

## 9. Event-driven design and SLA engine

### Workflows

**A. Ticket creation and event fan-out.** TicketsService fetches the organisation's SLA policy (for example, 2 hours for a Pro org), sets `sla_deadline = NOW() + 2h`, saves the ticket in Postgres, and publishes `ticket.created` to Kafka using **orgId as the partition key**. Partitioning by orgId keeps one tenant's events in order.

**B. SLA deadline tracking and breach detection.**
1. The SLA consumer receives `ticket.created` and adds the ticket to a Redis sorted set: `ZADD sla:active_timers <unix_timestamp> <ticketId>`.
2. If an agent replies before the deadline, the comment handler removes the timer: `ZREM`.
3. A NestJS cron worker runs every 10 seconds: `ZRANGEBYSCORE sla:active_timers -inf <now>`.
4. Each overdue ticket triggers an `sla.breached` Kafka event: the ticket is flagged, priority is escalated, a red WebSocket alert goes to the lead/online supervisors, and an escalation email is sent.

**C. Live chat and internal notes.** Agents and customers join the room `org:{orgId}:ticket:{ticketId}`. Normal replies broadcast to both. When an agent marks a message as an internal note (`isInternalNote: true`), the gateway emits it **only** to `org:{orgId}:agents`, so it never reaches the customer client.

### Why a Redis sorted set instead of polling Postgres
Polling Postgres every 10 seconds for open tickets past their deadline adds growing read load as tickets accumulate. A sorted set returns expired deadlines in O(log N + M) time from memory, and Postgres is touched only when a real breach happens.

### Topics named in the plan
- `ticket.created` (partitioned by orgId)
- `sla.breached`

---

## 10. Build plan (10 steps)

Each step must **run on its own** before moving on, so there is always a working system.

### Phase 1: Foundation and auth
1. **Project setup.** NestJS via `nest new helpdesk-backend` (npm). Understand modules, controllers and services (controller = traffic cop, service = brain). Run it; GET / returns Hello World.
2. **Database and User entity.** Connect NestJS to Postgres; create the first entity.
3. **Auth.** Signup/login, password hashing (bcrypt), JWT, auth guards.

### Phase 2: Multi-tenancy and scoped CRUD
4. **Organizations and multi-tenancy.** Organization entity, onboarding flow, roles (ADMIN, AGENT, CUSTOMER), the tenant interceptor.
5. **Tickets and comments CRUD scoped to the tenant.** Verify strict isolation. **Prove multi-tenancy works before adding anything else.**

### Phase 3: Frontend and live chat
6. **Next.js frontend.** Customer Portal and Agent Queue talking to the API.
7. **Live chat with Socket.io.** Bidirectional ticket chat, Redis agent presence, private internal-note filtering.

### Phase 4: Events, SLA and Docker
8. **Kafka.** Producers and consumers, starting with just `ticket.created` to a notification consumer.
9. **Dockerise everything.** `docker-compose.yml` for all services.
10. **SLA timers and breach events,** plus polish: agent dashboard with ticket counts, filters, canned responses.

---

## 11. Proof of concept (first working slice)

The proof of concept is the result of Steps 1 to 5. It is done when:

- A user can register an organisation and log in, and receives a JWT.
- ADMIN, AGENT and CUSTOMER permissions are enforced by guards.
- A user from organisation A **cannot** read or change organisation B's tickets.
- Tickets and comments can be created and listed only within the user's own organisation.

Real-time chat, Kafka and the SLA engine come only after this works.

---

## 12. How to work with me (mandatory)

The developer is a **beginner** building this to learn and sharpen skills.

**Teaching rules**
- Work **one step at a time.** Do not jump ahead or scaffold future steps.
- Before writing code, explain **why** we are doing it and how it fits the system design.
- After writing code, explain what each part does in plain language (decorators, modules, services, queries, etc.).
- Explain how the system design works at each step, not just the code.
- Do NOT end steps with understanding-check questions (developer's instruction). Explain in depth, then move forward.
- Prefer small, runnable changes. Each step leaves a working system.
- Write the code and explain it; the developer can choose to retype important parts (tenant guard, SLA logic) if they want to.

**Safety rules**
- Ask before running commands that install packages, change files outside this project, or touch Docker.
- Do not add features, services or libraries beyond this plan without asking.
- If something in the plan looks wrong, risky or outdated, say so instead of silently changing it.
- Never commit secrets. Keep them in `.env`, add `.env` to `.gitignore`, and commit a `.env.example`.
- Do not describe unmeasured targets (latency, cost) as results.

**Progress tracking**
- After each completed step, update `PROGRESS.md` with: what was built, key files, decisions made, and anything the developer found confusing. The developer pastes this into claude.ai for design discussions, so keep it short and clear.

---

## 13. Open questions for the senior reviewer

Do not resolve these without the developer's say-so.

1. **Tenant isolation.** ~~Is a NestJS guard plus repository auto-filter enough for Phase 1, or should PostgreSQL Row-Level Security be enabled immediately?~~ Decided by the developer on 2026-10-26: guard and query scoping **and** RLS are all on (see section 6). The reviewer can still challenge this.
2. ~~**SLA timer.** Planned Redis sorted-set polling worker, or BullMQ delayed jobs backed by Redis?~~ Decided by Claude, Oct 2026 (developer said to build the best app): the plan's Redis sorted set with a 10 s poller (`src/sla/`), with the database as the authority on what is overdue. The reviewer can still challenge it.
3. ~~**Local broker.** Use Redpanda (single-binary, Kafka-compatible) in `docker-compose.yml` instead of JVM Kafka + Zookeeper, to reduce local RAM use?~~ Decided by Claude, Oct 2026: Redpanda. The reviewer can still challenge it.

---

## 14. Expected infrastructure cost (from the plan; not independently verified)

| Layer | Tier 1: Local dev (Docker Compose) | Tier 2: Portfolio cloud demo | Tier 3: Production MVP (~50 orgs, 10K tickets/month) |
|---|---|---|---|
| Next.js frontend | localhost ($0) | Vercel Hobby ($0) | Vercel Pro / Cloudflare ($20) |
| NestJS API and WebSocket | Local container ($0) | Render / Railway starter ($5 to $7) | 2 managed app nodes ($24 to $36) |
| PostgreSQL | Container ($0) | Neon / Supabase free ($0) | Managed HA Postgres ($15 to $25) |
| Kafka bus | Redpanda container ($0) | Upstash / Confluent free ($0 to $5) | Managed Kafka / Redpanda ($25 to $45) |
| Redis | Redis container ($0) | Upstash free ($0) | Managed Redis 1 GB ($10 to $15) |
| **Total per month** | **$0** | **$0 to $12** | **$94 to $141** |

While learning, everything runs on Tier 1 at no cost. Provider prices change; check before spending money.

---

## 15. Next action

Start **Step 1**: create the NestJS backend with `nest new helpdesk-backend` (npm), then walk the developer through the generated structure (`main.ts`, `app.module.ts`, `app.controller.ts`, `app.service.ts`), explaining what each does and what `@Module` and `@Get()` mean. Ask the developer to answer in their own words what `@Get()` does before moving to Step 2.
