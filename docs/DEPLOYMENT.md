# Deploying and running the help desk

This guide takes one Linux server (a small cloud VM is enough to start) from nothing to a working, HTTPS-protected
system, and then covers the day-to-day: updates, backups, monitoring and what to do when something is wrong.
Everything here is written down for a first deployment; nothing in it has been run on a real internet-facing server
by the authors, so read the "Before you go live" checklist and test your own restore.

## What you need

- A server with **Docker Engine and Docker Compose 2.24 or newer**, 4 GB of memory or more (Redpanda alone wants about
  1 GB), and ports 80 and 443 open to the internet.
- Two DNS names pointing at the server's IP address: one for the web app (`app.example.com`) and one for the API
  (`api.example.com`). The browser talks to the API directly for live chat, which is why it needs its own name.
- An SMTP account from an email provider (for receipts, SLA alerts, invitations and password resets), and a sender
  address that provider allows you to use.

## First deployment

```bash
git clone https://github.com/<you>/Real-Time-Multi-Tenant-Helpdesk-SaaS.git /opt/helpdesk
cd /opt/helpdesk
cp deploy/.env.production.example .env
nano .env        # replace every value marked CHANGE; generate secrets with: openssl rand -hex 32
docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml up -d --build
```

The first start builds the images (several minutes), applies the database migrations, and asks Let's Encrypt for
certificates for both names (this works only once DNS points at the server and ports 80/443 are reachable).

Check that it is healthy:

```bash
docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml ps        # every service "healthy" (migrate "exited (0)")
curl https://api.example.com/api/v1/health                                       # {"status":"ok","database":"up","redis":"up"}
```

Then open `https://app.example.com` and create the first organisation. With `ALLOW_REGISTRATION=false` (the
production template's default) the public sign-up closes, so create your first organisation **before** you close it:
start with `ALLOW_REGISTRATION=true`, register, then set it to `false` and run the `up -d` command again.

To avoid retyping the two `-f` options, add this to your shell profile:
`alias hd='docker compose -f /opt/helpdesk/docker-compose.yml -f /opt/helpdesk/deploy/docker-compose.prod.yml --project-directory /opt/helpdesk'`.

## Before you go live: checklist

- [ ] Every `CHANGE` value in `.env` is replaced with a long random value, and `.env` is readable only by you
      (`chmod 600 .env`). It is not in git; keep a copy in a password manager.
- [ ] `ALLOW_REGISTRATION=false` unless strangers may create organisations.
- [ ] You can see an email arrive: invite yourself as a second user from the Team page, or use "Forgot password".
- [ ] You have **restored a backup** onto a spare database at least once (see below). An untested backup is a hope.
- [ ] Only ports 22, 80 and 443 are open in the server's firewall (the production compose file already avoids
      publishing anything else, but a firewall is a second lock).
- [ ] Automatic security updates are on for the operating system, and someone gets the Dependabot pull requests.
- [ ] You know who to tell and what to do when it is down (the last section is a starting point).

## Updating

```bash
cd /opt/helpdesk
git pull
docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml up -d --build
```

Migrations run automatically before the API starts, and only the services whose image changed are replaced.
Migrations are **forward-only** (an applied migration is never edited), so before a release that adds one, take a
backup first. To roll back the application code, check out the previous version and run the same command; roll the
database back only from a backup.

## Backups and restore

The database is the only data that cannot be recreated. (Redis holds presence and running SLA timers; the system
rebuilds both from Postgres, so Redis is not backed up.)

```bash
./deploy/backup.sh          # writes backups/helpdesk-YYYY-MM-DD-HHMM.dump, checks it can be read, deletes ones older than 14 days
```

Run it nightly from cron and **copy the files off the server** (object storage, another machine).

To test a restore without touching the live data, restore into a spare database:

```bash
docker exec helpdesk-postgres psql -U "$POSTGRES_USER" -d postgres -c "CREATE DATABASE restore_test"
docker exec -i helpdesk-postgres pg_restore -U "$POSTGRES_USER" -d restore_test --no-owner < backups/helpdesk-....dump
docker exec helpdesk-postgres psql -U "$POSTGRES_USER" -d restore_test -c "SELECT count(*) FROM tickets"
docker exec helpdesk-postgres psql -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE restore_test"
```

To restore for real after a disaster: stop the API (`docker compose ... stop backend frontend`), restore into the
live database (drop and recreate it first, then run the migrations container so the app role's grants exist), start
everything again.

## Watching it

- **Health:** `GET /api/v1/health` (used by Docker's health checks and any uptime monitor). It reports the database
  and Redis separately; only the database makes it unhealthy.
- **Metrics:** set `METRICS_TOKEN` and scrape `GET /api/v1/metrics` with `Authorization: Bearer <token>` using
  Prometheus. The numbers worth alerting on:

  | Metric | Alert when |
  |---|---|
  | `helpdesk_outbox_pending` and `helpdesk_outbox_oldest_seconds` | pending keeps growing, or the oldest event is older than a few minutes: events are not reaching Kafka |
  | `helpdesk_events_consumed_total{outcome="dead_letter"}` | rises: a consumer is giving up on events (look in the `*.dlq` topics) |
  | `helpdesk_http_request_duration_seconds` (p95) | well above your normal |
  | `helpdesk_http_requests_total{status=~"5.."}` | a rising share of 5xx responses |
  | `helpdesk_sla_breaches_total` | informational: how often deadlines are missed |

  Labels use route patterns and never tenant data, so the endpoint reveals load and nothing about customers.
- **Logs:** `docker compose ... logs -f backend` (rotated at 5 x 10 MB per service). Warnings worth reading:
  "restored N missing SLA timer(s)" (Redis lost data and the system repaired itself), "giving up on ... sent to DLQ".
- **Emails:** admins can see every email the system sent, and whether it was delivered, on the **Emails** page.

## Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| Live chat shows "Reconnecting…" forever | The browser cannot reach `API_DOMAIN`, or `FRONTEND_ORIGIN` does not exactly match the address in the browser (scheme and host). Check `docker compose logs backend`; the API refuses sockets from other origins on purpose. |
| Everyone is sent to the login page right after logging in | The cookie was not stored: the site must be served over HTTPS in production (cookies are marked `Secure`). |
| No emails arrive | Look at the **Emails** page: `FAILED` rows show the provider's error. Check `SMTP_*` and that `MAIL_FROM` is an allowed sender. |
| A few users get "Too many requests" | Login is limited to 10 attempts a minute per account and sign-up to 20 an hour per address. They clear by themselves. |
| New tickets do not reach agents' screens or emails | Check `helpdesk_outbox_pending` (events waiting) and `docker compose ps` for redpanda. The API keeps saving tickets meanwhile; events are delivered once the broker is back, in order. |
| SLA deadlines never fire | Look for the `sla` consumer and the timer in the API logs. After a Redis data loss the API rebuilds timers within ten minutes (or restart the API to do it at once). |
| Disk is filling up | Logs are rotated; the usual cause is old backups, or Redpanda's retention. `docker system df` shows where it went. |

## Rotating secrets

- **`JWT_SECRET`:** change it and restart the API; every user is signed out once (their next click sends them to log in).
- **Database passwords:** change `POSTGRES_PASSWORD` or `APP_DB_PASSWORD` in `.env` *and* in the database
  (`ALTER ROLE ... PASSWORD`), then restart. The `migrate` container re-applies the app role's password on every start.
- **SMTP password:** change it in `.env` and restart the API.

## What this setup does not do (yet)

- **One server, one copy of each service.** There is no automatic failover. The API itself can run several copies
  (chat and presence are shared through Redis), but the compose file runs one; to run more, remove `container_name`
  from the backend service and put a load balancer in front of the copies.
- **No automatic off-site backups, no log shipping, no alerting.** The pieces (backup script, metrics, health
  endpoint) are there; connecting them to your own tools is up to you.
- **Redpanda runs in single-node development mode.** That is fine for a modest workload, but a production-grade
  broker setup (replication, more partitions, retention tuning) is a separate piece of work if the volume grows.
