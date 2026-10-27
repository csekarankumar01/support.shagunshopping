# Deploy: web app on Vercel, API on Render

Order matters because the two services need each other's address:
**1** Render database and Redis, **2** Render API (gets its web address), **3** Vercel web app (uses that address),
**4** tell the API the web app's address. Never paste real values into files in this repo; type them in the dashboards.

First deployment runs with **events off** (`EVENTS_ENABLED=false`): tickets, live chat, accounts, OTP email and the
super admin all work; automatic ticket receipts and SLA breach alerts need Kafka and come later.

## 1. Render: database and Redis (same region as the API)

- **PostgreSQL** (New > PostgreSQL). Copy its *Internal Database URL*.
  The migration creates a restricted role (`helpdesk_app`) that the app runs as, so the database user must be allowed to
  create roles. If the first deploy stops with "may not create roles", run `CREATE ROLE helpdesk_app NOLOGIN;` once as
  the database owner (Render's database page has a shell/connection string) and redeploy, or use another Postgres host.
- **Key Value** (Redis-compatible, New > Key Value). Note the *internal* URL (`redis://...`).

## 2. Render: the API (New > Web Service, from this GitHub repo)

| Setting | Value |
|---|---|
| Language / runtime | Docker |
| Root directory | `helpdesk-backend` |
| Dockerfile path | `./Dockerfile` |
| Instance type | a paid always-on instance (a sleeping instance stops the SLA checker and chat) |
| Health check path | `/api/v1/health` |
| Pre-deploy command | `node db/migrate.mjs` |

Do **not** set `PORT`: Render provides it and the API reads it.

### Render environment variables

| Variable | Value | Notes |
|---|---|---|
| `DATABASE_URL` | the Render database's **Internal Database URL** | one value, copied whole (`postgresql://user:password@host/db`). It names the server and database and is used by the pre-deploy migration as the owner; the API itself then connects as `helpdesk_app` using `APP_DB_PASSWORD`. If it is missing, the deploy fails with "Cannot tell which database to use" |
| `POSTGRES_SSL` | `true` | if the log says the server does not support SSL, set `false` |
| `APP_DB_USER` | `helpdesk_app` | the restricted role the API runs as |
| `APP_DB_PASSWORD` | a NEW long random password | `openssl rand -hex 24`; the migration sets the role's password to this |
| `JWT_SECRET` | a NEW long random string | `openssl rand -hex 48`; also protects verification codes and 2FA secrets, so never reuse or lose it |
| `JWT_EXPIRES_IN_SECONDS` | `900` | |
| `REDIS_URL` | the Key Value internal URL | |
| `FRONTEND_ORIGIN` | `https://YOUR-APP.vercel.app` | set after step 3; no trailing slash; comma-separate to allow more |
| `TRUST_PROXY` | `2` | Vercel then Render each add a hop; check rate limits count real visitors |
| `EVENTS_ENABLED` | `false` | until a Kafka service is set up |
| `REQUIRE_EMAIL_VERIFICATION` | `true` | sign-up needs the emailed code |
| `ALLOW_REGISTRATION` | `true` | set `false` once your own organisation exists, if you do not want strangers signing up |
| `SMTP_HOST` | `smtp.resend.com` | |
| `SMTP_PORT` | `465` | |
| `SMTP_TLS` | `tls` | |
| `SMTP_USER` | `resend` | |
| `SMTP_PASSWORD` | your Resend API key | use a "Sending access" key; a full-access key was shared in chat, replace it |
| `MAIL_FROM` | `Helpdesk <no-reply@yourdomain.com>` | must be on a domain verified in Resend; until then `onboarding@resend.dev`, which only reaches your own Resend email |
| `PLATFORM_REQUIRE_2FA` | `false` at first, `true` after you set up 2FA | see "First super admin" |
| `METRICS_TOKEN` | optional long random string | protects `/metrics` |

After the deploy: open `https://YOUR-API.onrender.com/api/v1/health`. It should answer `ok` for database and Redis.

## 3. Vercel: the web app (Add New > Project, same GitHub repo)

| Setting | Value |
|---|---|
| Root Directory | `helpdesk-frontend` |
| Framework preset | Next.js (detected) |
| Node.js version | 22.x or 24.x (Project Settings > General) |
| Function region | the one closest to your Render region (Project Settings > Functions) |

### Vercel environment variables (Production)

| Variable | Value | Notes |
|---|---|---|
| `API_URL` | `https://YOUR-API.onrender.com` | server-side: the Next.js server calls the API with it. No trailing slash |
| `NEXT_PUBLIC_SOCKET_URL` | `https://YOUR-API.onrender.com` | baked into the page at BUILD time: if it changes, redeploy |

That is all the frontend needs. Set both **before** the first deploy.

## 4. Close the loop

1. Copy the Vercel address (e.g. `https://helpdesk-xyz.vercel.app`; use the stable production domain, not a preview URL).
2. In Render set `FRONTEND_ORIGIN` to it and let the API redeploy. Without this, live chat is refused (the API only
   accepts WebSocket connections from that origin) and password-reset/invitation links point at the wrong place.

## First super admin (once)

Run from your machine against the Render database (use its *external* connection details, and `POSTGRES_SSL=true`),
from `helpdesk-backend/`, passing the values on the command line so nothing is saved to a file:

```bash
DATABASE_URL='<External Database URL>' POSTGRES_SSL=true \
  JWT_SECRET=<the same JWT_SECRET as Render> node db/create-platform-admin.mjs you@example.com
# then two-factor (needs `npm run build` first because it reuses the API's code):
  ... node db/platform-2fa.mjs you@example.com
```

Then set `PLATFORM_REQUIRE_2FA=true` on Render. The console is at `https://YOUR-APP.vercel.app/platform/login`.
(The Render database must allow connections from your IP, or use Render's shell if your plan has one.)

## Checklist after deploying

- [ ] `/api/v1/health` is healthy; the web app loads and shows the sign-in page.
- [ ] Register an organisation with your own email: the code arrives (Resend), the organisation is created, you can sign in.
- [ ] A ticket and a live chat between two browsers work (proves `FRONTEND_ORIGIN` and WebSockets).
- [ ] Super admin signs in with a 2FA code.
- [ ] The Resend key in Render is a restricted "Sending access" key; the full-access key shared earlier is deleted.
- [ ] Later: add Kafka (receipts and SLA alerts), a custom domain, monitoring.
