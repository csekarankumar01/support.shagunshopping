# Progress

## Step 1: Project setup (done)

**Built:** NestJS backend scaffolded with `nest new helpdesk-backend` (npm, `--skip-git`). `GET /` returns `Hello World!` (HTTP 200, checked locally; the port was 3000 then and is 4310 since Step 6).

**Key files** (`helpdesk-backend/src/`):
- `main.ts`: starts the app and listens on `PORT` (4310; was 3000 until Step 6).
- `app.module.ts`: root module; wires the controller and service together.
- `app.controller.ts`: `@Get()` route that calls the service.
- `app.service.ts`: holds the logic (returns the greeting).

**Decisions:**
- No git repo yet. Plan is `git init` at the project root, not inside the backend (needs developer's OK; also add `.gitignore`, `.env.example`).
- Versions the CLI picked (latest, not pinned in the plan): NestJS 12, TypeScript 6, Vitest 4 for tests (not Jest). Developer confirmed: keep these versions.
- Git initialised at project root (branch `main`) with a root `.gitignore`; no commits yet.

**Confusing / to note:** generated code uses ESM (imports end in `.js`, top-level `await`), which differs from older Nest tutorials. The API's port must be free before `npm run start`.

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
- No `GET /tickets/:id` at this point (not in the plan; added in Step 6 because the detail page needs it). `ticket.created` Kafka event and WebSocket broadcast on comments come in Steps 7-8; SLA timer removal on agent reply is Step 10.
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

## Step 6: Next.js frontend (done) - Customer Portal and Agent Queue

**Built** (`helpdesk-frontend/`, Next.js 16.4.3 App Router, React 19.3.0, Tailwind 4, TypeScript 5):
- Pages: `/login`, `/register` (creates org + admin and signs in), `/tickets` (customers: "My tickets"; agents/admins: "Queue" with SLA column, status/priority filters, pagination), `/tickets/new` (customer only), `/tickets/[id]` (conversation, reply form; staff also get a status selector and an "internal note" checkbox), `/team` (admin only: invite an agent or customer).
- **Login token lives in an httpOnly, SameSite=Lax cookie set by the Next server** (`lib/session.ts`). The browser only talks to Next; Next calls the API server to server with `Authorization: Bearer` (`lib/api.ts`). So page JavaScript can never read the token, and the API needs **no CORS**.
- Forms are Server Actions (`app/actions/`) shown by small client components (`components/forms.tsx`, `useActionState`). `lib/auth.ts` asks the API `GET /auth/me` for the role instead of decoding the JWT in the frontend.
- `proxy.ts` redirects visitors with no cookie to `/login` (speed only; the API still verifies every call). A 401 from the API sends the user to `/login?expired=1`.
- Backend change: added `GET /api/v1/tickets/:id` (same org + customer-owns-it rules, 404 otherwise) with 3 new e2e tests, because the detail page needs it. Backend tests after the follow-up pass: 21 unit + 50 e2e, all passing.

**Ports changed (developer's request, other projects use the old ones):** API **4310**, Next **4311**. `PORT=4310` is in `.env`/`.env.example`; Next's port is in `helpdesk-frontend/package.json`; `API_URL` (default `http://localhost:4310`) in `helpdesk-frontend/.env.example`. Avoid 1338, 1339, 8000 (used elsewhere).

**Checked in a real headless Chrome against the running app (35 checks, throwaway database, script not in the repo):** no-cookie redirect; register/login/logout; cookie is httpOnly + SameSite=Lax and the token is not in `document.cookie` or the page HTML; admin invites; customer raises a ticket and replies; agent adds an internal note, changes status, replies; the customer sees the reply and new status but **neither the internal note's text nor its tag, even in the raw HTML**; a second customer gets a 404 page for the first customer's ticket; a malformed id gives 404; wrong password shows "Invalid credentials" and keeps the email; a forged cookie returns the user to `/login`. Lint and `next build` pass.

**Decisions / plan gaps filled:**
- Option 1 (httpOnly cookie via the Next server) chosen over localStorage + CORS. Step 7 will still need an origin allowlist (CORS) on the Socket.io gateway, plus a short-lived token handed to the browser just for the socket handshake, because the browser cannot read the httpOnly cookie.
- `/team` invite page and `GET /tickets/:id` were added beyond the plan's list; both are small and needed to use the app at all.
- Times: the server renders UTC (labelled) and the browser switches to the viewer's local time (see limitation 2 below).
- The scaffold left `cacheComponents` on, so every page that reads the cookie sits inside `<Suspense>` (a build error otherwise). `AGENTS.md` in the frontend is generated by Next and only says to read its bundled docs; I did, for cookies, proxy and cache components.

**Known limitations at the end of Step 6, and what happened to each (follow-up pass, same day):**
1. **Blank page after an early form submit: fixed.** Cause found with the browser's network capture: for a plain (no-JavaScript) form post, Next 16.4.3 with `cacheComponents` answers with the data scripts only, **no `<html>`/`<body>` shell**, so the browser has nothing to show (looks like a Next quirk; not reported upstream). Fix: every submit button is disabled until React has loaded (`SubmitButton` in `components/forms.tsx`, `lib/use-hydrated.ts`); a disabled default button also stops Enter submitting. The server-rendered HTML has the button disabled, and the browser tests now click the instant a button enables, with no sleeping. Sign-out (a redirecting action) was checked to work even when clicked immediately.
2. **Times in UTC: fixed.** `components/local-time.tsx` shows the viewer's own timezone once the page has loaded; until then (and without JavaScript) the server's UTC text, labelled "UTC", shows. Checked with the browser's timezone emulated as India.
3. **Author names: fixed (with one deliberate limit).** Backend: comments now carry `authorRole` and `authorEmail` (joined from `users`, same org; the create response has the same shape, which Step 7's live messages will reuse). **Staff see every author's email; a customer sees only their own** (for staff authors `authorEmail` is `null` and the page says "Support"), so customers never learn staff addresses. 2 new e2e tests, including "the agent's address appears nowhere in the customer's response". There are still no display names (users only have an email).
4. **Mobile layout: tested, one bug found and fixed.** Real 375px-wide window. A first version of my test used phone emulation that actually laid the page out at 998px, so it could not fail; I caught that by printing the measurements and fixed the test (it now fails without the fix: 622px too wide). Bug: a 150-character unbroken word in a comment or title pushed the page sideways. Fixed with `overflow-wrap:anywhere`; the list, detail and login pages no longer scroll sideways at 375px. Also checked the page ships a viewport meta tag.
5. **Accessibility: basic audit passes, not a full audit.** On login, register, list, new ticket and detail: every field has a label, no empty buttons or links, exactly one `h1`, `lang="en"`. **Not checked:** colour contrast, keyboard-only walkthrough, screen reader behaviour. Do not call the app "accessible" on this evidence.
6. **Other browsers: Chrome and Edge, 47/47 checks each.** Not Firefox or Safari (not installed here), and no real phone.

**Still open:**
- **No live updates (Step 7):** a page shows others' new messages only after reload or after your own action.
- The login cookie is `Secure` only in production builds, so plain http works on localhost (needed for local development).
- The browser test script (47 checks, about 4 minutes per browser) is temporary and not in the repo; the backend suite in `helpdesk-backend/test` is the permanent safety net. Worth turning into a real end-to-end suite if the frontend keeps growing.

**Tests now:** backend 21 unit + 50 e2e, frontend lint and `next build` clean.

## Step 7: Live chat with Socket.io (part 1 of 2 done: chat; Redis presence still to do)

**Built (backend, `src/realtime/`, `src/auth/verify-token.ts`):**
- `SupportGateway` at namespace `/support` (WebSocket transport only). The handshake needs a **60-second socket token** (`POST /api/v1/auth/socket-token`, for a logged-in user) and an allowed `Origin` (`FRONTEND_ORIGIN`, default `http://localhost:4311`). Org, user and role come only from the token.
- **Rooms** all start with the org id: `org:{org}:ticket:{id}` (the ticket's customer and staff), `org:{org}:ticket:{id}:staff` (staff watching it), `org:{org}:agents` (all connected staff). Joining a ticket runs the same `canAccessTicket` rule as the REST API ("Ticket not found" for other tenants, other customers and made-up ids alike).
- Messages are still **written through REST** (validated, saved, audited) and then published, after the save commits: `comment:new` and `ticket:status` (only when the status really changed). Plus `typing`. The customer's side gets public comments only, with staff authors' emails removed.
- Tokens are not interchangeable: REST refuses socket tokens, the socket refuses login tokens, and tokens with no expiry are now refused everywhere (stricter than before). The socket is dropped (`session:expired`) when the login session it came from ends.
- New packages: `@nestjs/websockets` 12.2.0 and `@nestjs/platform-socket.io` 12.2.0 (Socket.io 4.8.4) in the backend, `socket.io-client` 4.8.4 in the backend (dev, tests) and in the frontend.

**Built (frontend):** `app/api/socket-token/route.ts` (reads the httpOnly cookie, returns only the socket token), `lib/socket.ts` (one shared socket, a fresh token before every reconnect, rejoins rooms, reloads page data after a reconnect, typing throttle), `components/live-ticket.tsx` (status, conversation, "is typing", Live/Reconnecting indicator), `components/live-refresh.tsx` (the staff queue reloads itself when a status changes).

**Proof:**
- Backend: 28 unit + 68 e2e tests. 18 of the e2e tests are new and use a real Socket.io client against a real listening server: handshake refusals (including wrong origin), who may join, who receives what, typing, session expiry. **Mutation-checked: 9 deliberate breakages, each caught** (internal note sent to customers, staff email leaked, no access check on join, no origin check, REST accepting a socket token, socket accepting a login token, a customer in staff rooms, internal typing leaked, session expiry ignored).
- Browser: two real browsers at once (customer in Chrome, agent in Edge), 30 checks. Replies, internal notes and typing arrive live with no page reload and no duplicates. The customer never sees an internal note or the agent's address, even live. Status changes appear live. The queue refreshes itself. After the backend is killed and restarted, the page shows "Reconnecting...", reconnects by itself, and later messages still arrive (rooms rejoined). A page served from another origin (`127.0.0.1`) can log in over HTTP but its WebSocket is refused. The earlier 47-check browser suite was re-run: still 47/47.
- **Bug found by the browser test and fixed:** after an agent changed a status, React reset the form and the status dropdown snapped back to "OPEN" under a "Status updated." message. Fixed by remounting the select, keyed on the real status.

**Decisions / differences from the plan (please review):**
- Internal notes go to the **ticket's staff room** rather than the org-wide `org:{org}:agents` room the plan names. It is a strict subset (still staff only) and avoids sending note text to agents who are not looking at that ticket. `org:{org}:agents` carries queue-wide events (status changes).
- Typing indicators, including a staff-only "writing an internal note", were added (typing is in the plan's purpose section, not its API table).
- Sending stays on REST + Server Actions; the socket only delivers. One write path.
- The browser connects to the API directly for the socket only (`NEXT_PUBLIC_SOCKET_URL`, default `http://localhost:4310`).

**Not done / watch:**
- **Redis agent presence (part 2):** needs a Redis container in `docker-compose.yml` and the `ioredis` package; will ask before touching Docker. `users.is_online` stays unused (Redis will be the source of truth).
- One API instance only: Socket.io rooms live in memory, so two instances would need the Redis adapter (also part 2 territory).
- No rate limit on socket events (typing, join) beyond a 50-room cap per socket.
- Reconnect was tested by restarting the backend, not by an artificially slow network.
- New tickets do not appear in an open queue by themselves; that comes with Step 8's `ticket.created` event.
- The 9 `npm audit` findings in the backend are unchanged (scaffold packages such as multer, tmp, undici); none are in the new Socket.io packages. Frontend: 0.
- The browser test scripts (`ui-flow`, `live-flow`) are temporary files, not in the repo.

## Steps 7 (part 2), 8, 9 and 10: presence, events, Docker, SLA, polish (done; built autonomously on the developer's instruction)

**Built (backend):**
- **Redis agent presence:** sorted set per org with a 20 s heartbeat (a crashed server cannot leave ghosts), multi-tab aware, `GET /presence`, live `presence:changed`.
- **Kafka via a transactional outbox (migration 009):** `ticket.created` is written in the same transaction as the ticket; a relay publishes to Redpanda, keyed by org id (3 partitions per topic). Two narrow `SECURITY DEFINER` functions (`outbox_claim`, `outbox_complete`) let the relay read across tenants, like `auth_lookup_user`. Consumers in three groups: **notifications** (receipt email + live "new ticket" pop-up, SLA alert emails), **audit** (TICKET_CREATED), **SLA timers**. Retries (4 attempts, backing off), then a `<topic>.dlq` dead-letter topic; handlers are idempotent (unique keys), offsets are committed after handling. Real SMTP via nodemailer, caught by **Mailpit** in dev; `notifications` table = email log, admin page `/notifications`.
- **SLA engine (plan workflow B):** Redis sorted set `sla:active_timers` (`orgId:ticketId` scored by deadline). A check every 10 s (`ZRANGEBYSCORE`) flags overdue tickets, raises priority one level, audits (actor NULL), publishes `sla.breached`, which becomes a red live alert and supervisor emails. First public staff reply, or RESOLVED/CLOSED, removes the timer (`ZREM`). The database decides what is overdue (a timer Redis calls due but the database does not is kept); breaching is idempotent.
- **Product features (migration 010):** ticket assignment (audited), filters (assignee, breached, subject search with escaped LIKE), dashboard stats, team list, canned responses (CRUD), `GET /notifications` (admin).
- **Redis rate limiting:** login per account (10/min), register-org per IP (20/h), invite, socket-token, ticket and comment creation per user. Fails open if Redis is down. Behind Next.js the visitor's address is forwarded and trusted with `TRUST_PROXY`.
- `GET /api/v1/health` (database and Redis) for Docker.

**Built (frontend):** `/dashboard`, richer queue (search, assignee, breached filters, assignee column), assignment control and SLA badge on tickets, canned-response picker in the reply box and `/canned` page, `/team` member list, `/notifications` email log, online-staff line, staff pop-ups (new ticket, SLA breached), everything updating live.

**Step 9, Docker:** `docker compose up -d --build` runs postgres, redis, redpanda, mailpit, a one-shot `migrate`, the API and the web app (Node 24, multi-stage images, non-root, health checks, dependency ordering). The API container receives only what it needs: the restricted DB role (not the owner), Redis, Kafka, SMTP; verified that owner credentials are not in its environment.

**Proof:**
- Backend: **28 unit + 99 e2e tests** against real Postgres, Redis, Redpanda, Mailpit and WebSockets (e2e files run one at a time; tests use `test.*` Kafka topics). Mutation-checked this round: skipping the idempotency check, dropping a timer the database says is not due, and deleting outbox rows before Kafka accepts them, each caught (one test was vacuous at first and was fixed).
- Browsers against the Docker stack: **47/47** (login, roles, isolation, phone layout, accessibility), **30/30** live chat in two browsers incl. restarting the API container mid-test, **38/38** new features (live new-ticket alert, receipts via outbox, Kafka, SMTP and the email log, a real SLA breach end to end, assignment, filters, canned responses, presence, rate limiting through the UI, phone layout).
- Bugs found by the tests and fixed: inconsistent SQL parameter types in the outbox insert; the SLA check deleting timers the database did not consider due; e2e files interfering through the shared event bus; tests polluting the real Kafka topics (now `test.*`).

**Measured latency (this laptop, everything in Docker, same machine as the load generator, warm; not production numbers):**

| Request | p50 | p95 | p99 |
|---|---|---|---|
| POST /tickets, 1 client (n=250) | 7.2 ms | 10.5 ms | 22.3 ms |
| POST /tickets, 10 concurrent (n=500) | 22.5 ms | 36.4 ms | 63.1 ms |
| GET /tickets?limit=20, staff (~800 tickets) | 4.3 ms | 7.5 ms | 10.0 ms |
| GET /tickets/stats | 3.9 ms | 5.6 ms | 6.5 ms |
| Message posted to other user's socket, customer to agent (n=100) | 7.2 ms | 18.1 ms | 24.7 ms |
| Same, agent to customer (n=100) | 28.8 ms | 33.4 ms | 35.8 ms |

Against the plan's targets: ticket creation under 30 ms is met with one client (p99 22 ms) but **not under 10 concurrent clients** (p95 36 ms, p99 63 ms); chat under 100 ms is met locally (p99 36 ms). Neither says anything about production, a real network or a larger database.

**Decisions made by Claude (the developer said to build the best app; the reviewer can challenge them):**
- **Open question 3 (broker): Redpanda** in one container (plan's own suggestion, far less RAM than JVM Kafka + Zookeeper). **Open question 2 (SLA timers): the Redis sorted set + 10 s poller as in the plan**, not BullMQ, with the database as the authority on what is overdue.
- `@platformatic/kafka` (maintained, pure JS) instead of `kafkajs` (no release since 2023).
- Outbox instead of publishing from the request: no lost events on a crash and no broker latency in the request.
- Presence in Redis only; `users.is_online` stays unused.
- Customers never receive staff emails in comments, SLA alerts or presence.

**Known limits / not done:**
- One API instance: Socket.io rooms are in memory (a Redis adapter would be needed to scale out); presence heartbeats and SLA checks are safe to duplicate.
- If Redis loses its data, running SLA timers are lost (there is no rebuild from the database yet); AOF persistence is on.
- Emails go to Mailpit in dev; production needs real SMTP credentials and TLS in `.env`.
- Delivery is at-least-once with ordering per tenant only while the relay is healthy (a re-sent batch after a lease expiry can reorder).
- No refresh tokens or token revocation: a role change or removed user applies after the token expires (up to 1 h). No password reset, no change-password, no user deactivation.
- No Kafka consumer lag or other monitoring; dead-letter topics are not surfaced in the UI.
- `npm audit`: 9 findings in backend scaffold packages (multer, tmp, undici...), unchanged; frontend 0. Not reviewed or fixed.
- Accessibility: basic audit only (labels, headings, buttons); colour contrast and screen-reader behaviour not checked. Tested in Chrome and Edge only.
- The browser test scripts (`ui-flow`, `live-flow`, `features-flow`, `bench`) are temporary files, not in the repo. A caution if they are rewritten: waiting on a DOM element through the DevTools protocol must return a boolean (`!!el`); returning the element itself takes ~15 s because of React's internal object graph.
- `CLAUDE.md` was not updated for the change to autonomous working rules: that edit was blocked as self-modification. See memory notes and edit section 12 yourself if you want it written down.

**Next:** nothing is left on the plan's ten steps. Candidates: refresh tokens + revocation, password reset, Redis adapter for several API instances, SLA timer rebuild from the database, monitoring, CI (run the tests on every push), deployment to a cloud tier (CLAUDE.md section 14).


## Account security, browser tests, CI and deployment (built after Step 10; not yet committed)

- **Frontend account features:** `/account`, `/forgot-password`, `/reset-password`, team actions, session cookie handling (`lib/cookies.ts`, `proxy.ts`), matching backend session/auth changes (`session.service.spec.ts`).
- **Browser tests (`e2e/`, Playwright + axe):** 52 tests against the running Docker stack covering auth, roles, tenant isolation, tickets and queue, live chat, SLA breach, outbox/Kafka/SMTP, phone layout, security headers and accessibility. Last run: **52 passed** (2.7 min). Backend unit tests: 36 passed.
- **CI:** `.github/workflows/ci.yml`, `dependabot.yml`, helper scripts in `scripts/`.
- **Deployment:** `deploy/docker-compose.prod.yml`, `Caddyfile`, `backup.sh`, `docs/DEPLOYMENT.md`. Not deployed anywhere; nothing here is tested against a real cloud host.
- Backend e2e (`npm run test:e2e`) was not re-run in this session.

## UI redesign, README and security review (done 2026-10-27)

- **UI:** Inter font, gradient split-screen sign-in, sticky glass nav with active-link highlight, card dashboard and ticket page, dotted status/priority badges, chat avatars (own messages on the right). Shared styles live in `components/forms.tsx`, `badges.tsx`, `nav.tsx`, `nav-link.tsx`, `auth-card.tsx`, `app/globals.css`.
- **README.md** rewritten in depth (purpose, features, design decisions, security, tests, measured latency, resume summary). Pushed to `karaninfomerics/Real-Time-Multi-Tenant-Helpdesk-SaaS`.
- **Security review:** `npm audit` 0 findings in backend, frontend and e2e. One real bug fixed: emails were case-sensitive (login with the lowercase address failed; one person could hold two accounts). Emails and org slugs are now trimmed and lowercased (`src/auth/dto/email.ts`, migration `013_lowercase_emails.sql`); login password capped at 200 characters; HSTS header added to the web app.
- **Proof:** 38 unit, 132 backend e2e, 52 Playwright tests all passing after the changes.
- **Not done:** email verification at registration (any address is accepted unverified); revocation fails open if Redis is down (documented tradeoff); three type errors in backend test files (no effect on build or tests); the repo is not pushed to the `csekarankumar01` GitHub account (login on this laptop is `karaninfomerics`); no live deployment yet (a Cloudflare tunnel is blocked by the company firewall; plan is Render/Railway + Vercel).
- Note: the earlier "Known limits" list is partly outdated: refresh tokens, revocation, password reset and the Redis Socket.io adapter now exist.

**Next:** email verification, then cloud deployment (needs Render or Railway and Vercel accounts).

## Leftovers cleared (2026-10-27)

- The three type errors in backend test files are fixed (`tsc --noEmit` is clean).
- **Failed events page:** when a consumer gives up on an event after its retries, a readable copy is saved in `dead_letters` (migrations 014 and 015, RLS, admin-only `GET /api/v1/dead-letters`) as well as going to the `<topic>.dlq` Kafka topic. Admins see it at `/failed-events`. Unreadable messages with no org id stay only on the Kafka DLQ topic. Covered by the existing e2e "retries a failing email" test (extended). Backend: 38 unit + 132 e2e passing. The Playwright suite was not re-run after this change.
- Still open: email verification at registration, the push to the `csekarankumar01` account, deployment.

## Super admin console and a readable database (2026-10-27)

- **Platform (super) admin:** separate `platform_admins` table (no org), own login `POST /api/v1/platform/login`, own token (`purpose: platform`) that tenant routes and the WebSocket refuse (and the reverse). Created only by `npm run platform:create-admin -- email` (generated password shown once). Reads every tenant through extra `platform_*` Row-Level Security policies switched on per transaction (`app.platform_admin`), so isolation is still enforced by the database. Can: overview, search organisations, view users/tickets/comments (read-only), edit organisation name/plan/SLA, suspend/reactivate (ends all sessions at once; login says "suspended" only after a correct password), change a user's role or active flag (always keeps one active admin). Every change and every ticket view goes to append-only `platform_audit_logs`. Frontend at `/platform` (own cookie, own header). Key files: `src/platform/*`, `db/migrations/016_platform_admin.sql`, `app/platform/*`, `components/platform-forms.tsx`.
- **Readable database (migration 017):** a description on every table and column, and read-only `v_organizations`, `v_users`, `v_tickets`, `v_comments`, `v_audit_logs` views (names and emails instead of UUIDs). New `docs/DATABASE.md` with ER diagram, conventions, editing tips and handy queries. Tables stay editable in DBeaver as the owner.
- **Proof:** 38 unit and 148 backend e2e tests (16 new for the platform admin: token wall both ways, deactivation, cross-tenant reads, suspension, edits, audit, RLS), 56 Playwright tests (4 new, skipped unless `E2E_PLATFORM_EMAIL`/`E2E_PLATFORM_PASSWORD` are set; CI skips them). Browser tests were run against the production Docker build; against `next dev` three older tests fail for dev-server reasons (one needs the API in Docker).
- **Decision to review:** the super admin can read internal notes (read-only, audited). A stolen super admin account would expose every tenant, so use a long password and keep the account count low. Not built: two-factor login, password change for the super admin (re-run the create command to reset), "act as" tenants.

## Hardening round after the super admin (2026-10-27)

- **Direct database edits now take effect fast.** `AccountStateService` (cached 5 s) re-checks that the user exists, is active, belongs to a non-suspended organisation and still has the token's role, on every API request (`JwtAuthGuard`) and every WebSocket handshake. So switching someone off, re-roling them or suspending an organisation in DBeaver cuts them off within about 5 seconds. Test: `test/direct-edits.e2e-spec.ts`.
- **Two-factor sign-in for the super admin (TOTP).** `src/platform/totp.ts` (RFC 6238, checked against the RFC test vectors; Node crypto, no new dependency), secret stored AES-256-GCM encrypted (key derived from `JWT_SECRET`), each code usable once (replay refused, `totp_last_step`), code asked for only after the password is right. Set up on the server with `npm run platform:2fa -- email` (enables only after you type a valid code, so you cannot lock yourself out; `--off` removes it). `PLATFORM_REQUIRE_2FA=true` makes it mandatory (migration 018). Not built: backup codes (recover by running the command with `--off` on the server) and a per-account lockout on wrong codes (login is limited to 10 per minute per address).
- **Browser test reliability against `next dev`:** the dev server sometimes cancels the first request of a redirect (`ERR_ABORTED`); tests that expect a redirect to /login now use a tolerant `visit()` helper and poll for cookies. One real test race was fixed (a poll that waited on an already-revoked token). The API-restart test skips unless the API is the Docker container. Four runs in a row pass against `next dev`.
- **Proof:** 44 unit, 151 backend e2e, 55 browser tests passing (1 skipped as described).
