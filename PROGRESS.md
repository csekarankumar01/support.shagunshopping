# Progress

## Step 1: Project setup (done)

**Built:** NestJS backend scaffolded with `nest new helpdesk-backend` (npm, `--skip-git`). `GET /` returns `Hello World!` (HTTP 200, checked locally on port 3000).

**Key files** (`helpdesk-backend/src/`):
- `main.ts`: starts the app and listens on `PORT` or 3000.
- `app.module.ts`: root module; wires the controller and service together.
- `app.controller.ts`: `@Get()` route that calls the service.
- `app.service.ts`: holds the logic (returns the greeting).

**Decisions:**
- No git repo yet. Plan is `git init` at the project root, not inside the backend (needs developer's OK; also add `.gitignore`, `.env.example`).
- Versions the CLI picked (latest, not pinned in the plan): NestJS 12, TypeScript 6, Vitest 4 for tests (not Jest). Developer confirmed: keep these versions.
- Git initialised at project root (branch `main`) with a root `.gitignore`; no commits yet.

**Confusing / to note:** generated code uses ESM (imports end in `.js`, top-level `await`), which differs from older Nest tutorials. Port 3000 must be free before `npm run start`.

## Step 2: Database and User table (done)

**Built:**
- Postgres 17 runs in Docker (`docker-compose.yml`, Postgres only, named volume). Credentials in git-ignored `.env`; `.env.example` committed.
- `users` table (id UUID PK, email, password_hash, created_at), written by the developer in DBeaver and saved as `helpdesk-backend/db/migrations/001_create_users.sql`.
- NestJS connects with a `pg` connection pool. App logs `Connected to database "helpdesk"` on startup.

**Key files:** `src/database/database.service.ts` (pool + `query(sql, params)`), `src/database/database.module.ts`, `src/app.module.ts` (loads `../.env` via `@nestjs/config`).

**Decisions:**
- **No ORM (developer's choice):** plain SQL with `pg` to build SQL skills; CLAUDE.md updated. Tenant safety will rely on one central query helper that always applies `org_id`.
- Packages: `@nestjs/config` 12, `pg` 8, `@types/pg` 8. Postgres image tag `postgres:17`.
- Migrations are applied by hand in DBeaver for now; no runner yet.
- `email` has no unique rule yet (becomes unique per org in Step 4).
- DBeaver needed `JAVA_TOOL_OPTIONS=-Duser.timezone=Asia/Kolkata` (user-level) because the Postgres 17 image rejects Java's legacy `Asia/Calcutta` timezone name.
- `npm audit` shows 9 findings, all in the Nest scaffold (not new packages); not fixed, review before deployment.

**Confusing:** host vs database name vs user (`localhost` vs `helpdesk`); why the column is `password_hash`.

## Step 3: Auth (done)

**Built:**
- `POST /api/v1/auth/signup`: validates input, bcrypt-hashes the password (cost 10), inserts with `$1, $2` params, returns `{id, email}` (never the hash). Duplicate email gives 409.
- `POST /api/v1/auth/login`: checks the hash, returns `{accessToken}` (JWT, payload `{sub, iat, exp}`, 1 hour). Wrong password and unknown email give the same 401 message.
- `JwtAuthGuard`: reads `Authorization: Bearer <token>`, verifies signature and expiry, sets `request.user = { userId }`. Demo route `GET /api/v1/auth/me` is guarded.
- Checked against the running app: no token, garbage token, tampered `sub`, token signed with another secret, and wrong scheme all return 401; a valid token returns 200.

**Key files:** `src/auth/` (`auth.controller.ts`, `auth.service.ts`, `auth.module.ts`, `jwt-auth.guard.ts`, `dto/signup.dto.ts`, `dto/login.dto.ts`), `db/migrations/002_unique_email.sql`, `src/main.ts` (global `ValidationPipe` with whitelist + forbidNonWhitelisted).

**Decisions:**
- New packages: `bcrypt` 6, `@nestjs/jwt` 12, `class-validator` 0.15, `class-transformer` 0.5.
- `JWT_SECRET` and `JWT_EXPIRES_IN_SECONDS` live in `.env` (secret is random, git-ignored); placeholders in `.env.example`.
- Extra request fields are rejected (stops a visitor sending `role: ADMIN`).
- `/signup` and `/me` are temporary: `/register-org` replaces signup in Step 4; `UNIQUE(email)` becomes `UNIQUE(org_id, email)`.
- Developer asked to stop end-of-step quiz questions; CLAUDE.md section 12 updated.

**Confusing:** SQL injection and why `params` exist; host vs database name vs user.

**Not done / watch:** no refresh tokens or logout (token is valid until it expires); no rate limiting on login yet (planned later with Redis); `npm audit` findings in the Nest scaffold still unreviewed.

## Step 4: Organizations, roles and tenant context (done)

**Built:**
- Migrations `003_create_organizations.sql` and `004_users_org_and_role.sql`: `organizations` table; `users` gets `org_id` (FK, NOT NULL), `role` (CHECK ADMIN/AGENT/CUSTOMER), `is_online`; email unique per org via `UNIQUE (org_id, email)` (replaces migration 002's global rule). Migrations are applied by hand with `psql` (no runner yet).
- `POST /api/v1/auth/register-org`: creates the organization and its first ADMIN in one DB transaction (`DatabaseService.transaction`). Duplicate slug gives 409 and leaves no orphan rows. Replaces `/signup`.
- `POST /api/v1/auth/login` now takes `orgSlug`, `email`, `password`; JWT payload is `{ sub, orgId, role }`.
- `JwtAuthGuard` sets `request.user = { userId, orgId, role }`. New `RolesGuard` plus `@Roles(...)` decorator (deny by default if a route has no roles).
- `POST /api/v1/auth/invite` (ADMIN only): creates an AGENT or CUSTOMER in the caller's own org. The org comes from the token, not the body.

**Checked against the running app:** same admin email registered in two orgs; login needs the right org slug; AGENT and CUSTOMER get 403 on `/invite`; no token gets 401; `role: ADMIN` and an extra `orgId` in the body are rejected (400); same email is allowed in a second org but not twice in one.

**Decisions:**
- Login needs `orgSlug` because email is only unique per org (the plan's `/login` did not say how to pick the org). Alternative would be a globally unique email, which contradicts the plan's `(org_id, email)` rule.
- `/invite` is simplified: the ADMIN sets the invitee's initial password. A real emailed invite link waits for the Kafka notification step.
- `role`/`plan` use `CHECK` constraints instead of Postgres enum types (easier to change later). Default `sla_mins` is 480.
- Row-Level Security: **still undecided**, not enabled. Open reviewer question 1 stays open.
- The central "tenant-scoped query helper" that always requires `orgId` is planned for Step 5, when tenant tables with real data (tickets) exist.

**Not done / watch:** the role is stored in the token, so a role change only applies after the old token expires (up to 1 hour); no way to remove or change a user's role yet; no rate limiting on login or register-org.

## Step 5: Tickets and comments scoped to the tenant (done) - proof of concept reached

**Built:**
- Migration `005_tickets_comments_audit.sql`: `tickets`, `comments`, `audit_logs`; index `(org_id, status, priority)` on tickets; composite foreign keys so the DB itself rejects cross-tenant links (e.g. a comment whose org differs from its ticket, or assigning another org's agent); `audit_logs` is append-only via a trigger.
- `DatabaseService.tenantQuery` / `tenantTransaction`: always pass `orgId` as `$1`; refuse SQL that does not mention `org_id` and `$1` (a tripwire, not a guarantee). Plain `query()` is kept only for pre-tenant work (login, register-org).
- Tickets: `GET /api/v1/tickets` (paginated, filter by status/priority, max 100 per page), `POST /api/v1/tickets` (CUSTOMER only; `sla_deadline` = now + org `sla_mins`, set in SQL), `PATCH /api/v1/tickets/:id/status` (ADMIN/AGENT; status change + audit row in one transaction).
- Comments: `GET` and `POST /api/v1/tickets/:ticketId/comments`. Internal notes are removed in SQL for customers; customers cannot post internal notes (403).
- `@CurrentUser()` decorator; `ValidationPipe` now has `transform: true`.

**Proof (42 checks, run against the live server and DB; script was temporary and is not in the repo):** customers see only their own tickets; agents/admins see only their own org; org B cannot read, comment on or change org A's tickets (all 404); same-org customers cannot see each other's tickets; roles enforced (403/401); internal notes never reach customers; DB rejects cross-org rows and edits/deletes on audit logs even when bypassing the app.

**Bug found by the tests and fixed:** a subject of only spaces gave a 500 (caught by the DB CHECK). Input is now trimmed before validation, so it is a 400.

**Decisions / plan gaps filled:**
- Added `tickets.requester_id` (not in the plan) so customers only see their own tickets.
- Cross-tenant access returns 404, not 403, so ids cannot be probed.
- Statuses OPEN/IN_PROGRESS/RESOLVED/CLOSED and priorities LOW/MEDIUM/HIGH/URGENT chosen by me (plan did not name them).
- Only CUSTOMERs create tickets (per plan); agents cannot create on a customer's behalf yet.
- Only status changes are audited (plan: status and assignment). There is no assign-agent endpoint yet, so `agent_id` stays NULL.
- No `GET /tickets/:id` (not in the plan). `ticket.created` Kafka event and WebSocket broadcast on comments come in Steps 7-8; SLA timer removal on agent reply is Step 10.
- Row-Level Security: still undecided and not enabled (open reviewer question 1).

**Not done / watch:** the permanent automated test suite does not exist yet (only the scaffold's example tests); no index for the customer "my tickets" query or for `ORDER BY created_at`; migrations are still applied by hand.

## Hardening after Step 5 (done): the "honest limits" fixed

**1. Migration runner.** `npm run db:migrate` (`db/migrate.mjs`): applies numbered files in order, records each in `schema_migrations` with a checksum, one transaction per migration, advisory lock against two runners, refuses a changed already-applied file. Proven by rebuilding all 8 migrations from empty in a throwaway database and diffing: identical to the dev schema. Dev DB was adopted with `--baseline 005`.

**2. Indexes (migration 007).** `(org_id, created_at DESC, id)` and `(org_id, requester_id, created_at DESC, id)`. On 90,000 seeded tickets: agent queue 8 ms to 0.07 ms (read 20 rows instead of 30,000), customer list 4.3 ms to 0.13 ms (`EXPLAIN ANALYZE`, local).

**3. Row-Level Security (migration 008) - developer asked for it, decision recorded in CLAUDE.md.**
- RLS policy `tenant_isolation` on organizations, users, tickets, comments, audit_logs, keyed on `app.current_org_id`, set per transaction with `set_config(..., true)` (cannot leak across pooled connections). No context means no visible rows.
- Needed a restricted role: the Postgres Docker user is a superuser and superusers bypass RLS. Migration 006 creates `helpdesk_app` (no DELETE, audit_logs insert/read only); the app now connects as it (`APP_DB_USER`/`APP_DB_PASSWORD` in `.env`). Migrations still run as the owner.
- Login happens before the tenant is known, so it uses one narrow `SECURITY DEFINER` function, `auth_lookup_user(slug, email)`. `register-org` generates the org id in the app and sets it as context before inserting.
- Cost: every tenant query is now BEGIN + set_config + query + COMMIT (4 round trips).

**4. Permanent tests.** 21 unit tests (tripwire, tenant-context SQL sequence and rollback, RolesGuard, JwtAuthGuard incl. forged/expired/foreign-secret tokens) and 45 end-to-end tests (API behaviour plus direct-to-database checks as the `helpdesk_app` role). E2E runs against a separate `helpdesk_test` database built from the real migrations, so dev data is never touched. Mutation-checked: switching RLS off made 7 database tests fail; removing the customer ownership filter made the API test fail; both restored.

**5. Measured latency (local; not production numbers).** Server and Postgres-in-Docker on the same laptop, empty-ish table (~1,000 rows), RLS on, warm, JWT already issued, no Kafka yet, load generator on the same machine.

| Request | p50 | p95 | p99 | max |
|---|---|---|---|---|
| POST /tickets, 1 client, n=400 | 4.8 ms | 6.3 ms | 8.1 ms | 11.1 ms |
| POST /tickets, 10 concurrent, n=600 | 10.9 ms | 18.3 ms | 44.3 ms | 48.6 ms |
| GET /tickets?limit=20 agent, n=400 | 3.3 ms | 5.2 ms | 6.4 ms | 7.7 ms |
| GET /tickets?limit=20 customer, n=400 | 3.2 ms | 4.1 ms | 5.4 ms | 6.2 ms |

Against the plan's "under 30 ms ticket creation": met at p50/p95 here, but p99 under 10 concurrent clients was 44 ms, so do not claim it as achieved. The Kafka publish (Step 8) will add to it, and a larger table and real network will change it. Chat latency (100 ms goal) is not measurable until Step 7.

**Still open:** `npm audit` findings (all in the Nest scaffold; not reviewed); no rate limiting on login/register-org; no refresh tokens or revocation; roles live in the token for up to an hour; `agent_id` has no assignment endpoint yet; the benchmark script was a temporary file and is not in the repo.

**Next:** Step 6, Next.js frontend (Customer Portal and Agent Queue).
