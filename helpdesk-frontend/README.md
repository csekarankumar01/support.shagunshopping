# Help desk web app (Next.js)

The customer portal and agent queue. See the [project README](../README.md) for the whole system and
[`CLAUDE.md`](../CLAUDE.md) for the design rules this code follows.

## Run it

```bash
npm install
npm run dev        # http://localhost:4311   (the API must be running on http://localhost:4310)
npm run lint
npm run build      # production build; also type-checks
```

Only one copy can use port 4311: stop the `frontend` container first if the Docker stack is running
(`docker compose stop frontend`).

## How it works

- **Sessions.** A login is two `httpOnly` cookies set by this server: a 15-minute access token and a 14-day
  refresh token. Page JavaScript can read neither. `proxy.ts` renews the access token shortly before it expires, so
  people are not logged out while they work. The browser never calls the API directly, except for the live-chat
  WebSocket, which uses a separate 60-second socket-only token from `app/api/socket-token`.
- **Data.** Pages are Server Components that call the API through `lib/api.ts`; forms are Server Actions in
  `app/actions/`. Every page that reads the login cookie sits inside `<Suspense>` (required by `cacheComponents`).
- **Live updates.** `lib/socket.ts` keeps one shared socket; `components/live-ticket.tsx`, `live-refresh.tsx` and
  `staff-live.tsx` apply what arrives.

## Rules worth knowing

- Every submit button is a `SubmitButton`: disabled until the page's JavaScript has loaded (a plain form post would
  return a blank page with this Next.js version).
- The API answers **401 only for a lost or ended session**; this app reads any 401 as "your login ended" and sends
  the person to the login page. An action by a logged-in person that is simply refused (for example a wrong current
  password) must be a 400/403/404.
- Role checks in the UI only tidy the interface. The API is the real enforcement.

## Tests

The browser tests live in [`../e2e`](../e2e) (Playwright, including automated accessibility checks) and run against
the whole stack.
