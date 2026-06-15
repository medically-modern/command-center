# monday-gateway

A standalone Railway service that sits between the Command Center SPA and the
Monday.com GraphQL API. **It is separate from `baseline-cron`** — its own
service, own root directory, own database.

## Why it exists

Today the browser talks straight to `api.monday.com`, with the Monday token
baked into the public JS bundle. That means:

- the token is extractable by anyone who views source;
- there is no server-side record of who wrote what;
- a multi-step "Send to Monday" must stay online in the tab for ~10–15s, so
  flaky Wi-Fi or a closed tab can leave a patient half-written.

This gateway is **Phase 1**: a transparent proxy that moves the token
server-side and logs every request to Postgres. It is intentionally dumb —
`POST /gql` forwards whatever `{ query, variables }` the app sends and returns
Monday's response verbatim, so new queries / columns / boards never require a
change here.

## Endpoints

| Method | Path      | Purpose |
|--------|-----------|---------|
| GET    | `/health` | Liveness + DB reachability + token presence (use as Railway healthcheck) |
| POST   | `/gql`    | Transparent Monday GraphQL proxy + audit log |

`/gql` accepts the same body the app already sends (`{ query, variables }`),
injects the Monday token server-side, forwards to Monday, returns the response
unchanged, then writes one audit row (fire-and-forget — logging never blocks or
fails the client).

## Deploy on Railway (new service, same project)

1. **New service → Deploy from repo**, pick `medically-modern/command-center-test`.
2. **Settings → Root Directory:** `services/monday-gateway`
   (Railway builds from the Dockerfile here; nothing else in the repo is touched.)
3. **Add a Postgres database** to the project (New → Database → PostgreSQL).
4. **Variables** (Settings → Variables):
   - `MONDAY_API_TOKEN` = the same token currently in the `VITE_MONDAY_API_TOKEN` GitHub secret
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}` (reference the Postgres service)
   - `ALLOWED_ORIGINS` = `https://medically-modern.github.io` (add `http://localhost:5173` for local dev)
   - optional: `LOG_MODE` (default `all`), `LOG_PAYLOAD` (default `false`), `GATEWAY_CLIENT_KEY`
5. **Networking → Generate Domain.** Note the URL, e.g.
   `https://monday-gateway-production.up.railway.app`.
6. **Healthcheck path:** `/health`.

The Postgres schema is created automatically on boot. `db/schema.sql` is the
same DDL for reference / ad-hoc queries.

## Cutover (flip the SPA onto the gateway)

The SPA change is one variable — no code edits.

1. In the repo's GitHub **Actions secrets**, add
   `VITE_MONDAY_GATEWAY_URL` = your gateway domain (no trailing slash).
2. Wire it into the build the same way the other `VITE_*` vars are wired in
   `.github/workflows/deploy.yml` (add it to the `env:` block of the Build step).
3. Re-run the deploy. Every `gql()` in the app now routes through the gateway.

**Rollback:** remove `VITE_MONDAY_GATEWAY_URL` and rebuild. The app falls back
to calling Monday directly. Instant, no code changes.

Verify after cutover: open the site, watch the network tab — GraphQL calls go to
`…/gql`, and `SELECT * FROM gql_writes LIMIT 20;` shows rows.

## Logging & PHI — read before enabling full payloads

`variables` on a write contain **patient data (PHI)**: names, DOB, insurance,
clinical fields. By default (`LOG_PAYLOAD=false`) the gateway logs **metadata
only** — who (`actor`/`client_ip`), which `item_id`/`board_id`, the operation,
the timestamp, and the outcome. That answers "who submitted what, from where,
when" without storing the patient content itself.

Set `LOG_PAYLOAD=true` only if you specifically want the full query + variables
stored, and only on a database you're comfortable holding PHI in (access
control, encryption at rest, and a BAA with the hosting provider as appropriate).

Example audit queries are at the bottom of `db/schema.sql`.

## Security notes (honest)

- The Monday token is now server-side — the single biggest win. The browser no
  longer needs it for GraphQL.
- The gateway authorizes to Monday with its own token, so **anyone who can reach
  `/gql` from an allowed origin can run queries** — same effective exposure as
  the bundled token today, but now centralized, logged, and revocable. `CORS`
  limits browsers to the allowlist; it does not stop a direct `curl`.
- `GATEWAY_CLIENT_KEY` adds a shared-secret check, but a key shipped in the
  bundle is obscurity, not real auth. Proper per-user auth is a later step.

## What Phase 1 does NOT do yet

- **File uploads/downloads** still go through the existing `monday-file-proxy`
  Cloudflare Worker, which still uses the browser-held token. So the token isn't
  fully gone from the bundle until **Phase 1b** (move file traffic here too, then
  drop `VITE_MONDAY_API_TOKEN` and the `Authorization` header in
  `src/lib/shared/mondayEndpoint.ts`).
- **Offline resilience** isn't solved by the proxy alone. **Phase 2** adds a
  transactional `POST /send` (server runs snapshot → write → verify → advance
  with idempotency + a Postgres-backed `pg-boss` retry queue) plus a client-side
  IndexedDB outbox, so a submit survives flaky Wi-Fi and closed tabs. The schema
  and choke point here are built to grow into that.

## Local run

```bash
cd services/monday-gateway
npm install
MONDAY_API_TOKEN=xxx DATABASE_URL=postgres://… npm start
# DATABASE_URL is optional locally; without it, logging is disabled and the
# proxy still works.
curl localhost:8080/health
```
