# Invoice Sync Service

A production-oriented backend service that keeps invoices, payments, and
general ledger accounts in sync between an internal invoicing system and
QuickBooks Online (QBO) — in both directions.

Internal changes (create, update, void) are pushed to QBO via a durable
job queue. QBO changes made by accountants arrive via webhook and are
pulled into the internal system. Field-level conflict detection handles
the case where both sides change the same invoice concurrently.

Key properties:
- **Durable** — BullMQ with exponential backoff; reconciliation watchdog
  re-queues stuck or failed jobs every 15 minutes
- **Idempotent** — BullMQ jobId deduplication + EventLog unique constraint
  + find-or-link on duplicate QBO create
- **Loop-safe** — pull path writes directly to the DB, never through the
  invoice use-case, preventing infinite push/pull cycles
- **Conflict-aware** — field-level rules auto-resolve most conflicts;
  `dueDate` changes on both sides require human resolution via API

Built with: Node.js 24 · TypeScript · Fastify · PostgreSQL · Prisma ·
BullMQ · Redis

---

## Prerequisites

- Node.js 24 LTS
- pnpm
- Docker + Docker Compose
- A QuickBooks Online developer account and sandbox company
  (<https://developer.intuit.com>)
- ngrok or equivalent for local webhook delivery

---

## Setup

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Fill in all values. See [Environment Variables](#environment-variables) below.
Generate the encryption key with:

```bash
openssl rand -hex 32
```

### 3. Start infrastructure

```bash
docker compose up -d postgres redis
```

### 4. Run database migrations

```bash
pnpm migrate
```

### 5. Authenticate with QuickBooks

Set `QB_REDIRECT_URI=http://localhost:3000/auth/qbo/callback` in `.env` and
register the same URL in the QBO developer portal (your app → Keys & OAuth →
Redirect URIs). Also set `FRONTEND_URL=http://localhost:5173` so the callback
redirects back to the Vite dev server after authorization.

**Initial token acquisition** — run this once before starting the service for
the first time, and make sure nothing else is using port 3000:

```bash
pnpm qbo-auth
```

Open the printed URL in a browser and complete the OAuth consent. The
terminal will confirm when tokens are saved and print their expiry times.

**Subsequent re-authentication** — once the service and frontend are running,
open the frontend Auth tab and click **Reconnect QBO**. No terminal access
required. The browser will complete the OAuth flow and redirect back to the
app with a success confirmation.

### 6. Configure webhook delivery

QBO webhooks require a public URL. For local development use ngrok:

```bash
ngrok http 3000
```

In the QBO developer portal, set the webhook endpoint to:
`https://<ngrok-id>.ngrok-free.dev/webhooks/qbo`

Copy the Verifier Token from the portal into `QB_WEBHOOK_VERIFIER_TOKEN`
in `.env`. Without this, webhook signature verification will reject all
incoming events.

### 7. Start the local demo

The local demo runs as two backend processes plus the frontend dev server.
Open three terminals:

**Terminal 1 — HTTP server:**
```bash
pnpm dev
```
Should log: `Server listening at http://0.0.0.0:3000`

**Terminal 2 — Queue worker:**
```bash
pnpm worker
```
Should log: `Workers started`

The worker handles all BullMQ jobs (reconcile push, pull from QBO,
payment sync, polling reconciliation). Without it, invoices will be
created in the DB but never synced to QBO.

**Terminal 3 — Frontend dev server:**
```bash
cd client && pnpm dev
```
Should log: `➜  Local:   http://localhost:5173/`

Open <http://localhost:5173> in your browser. On first load you will be
prompted for the API key — paste the value of `API_KEY` from your `.env`.
The frontend proxies all API calls to the Fastify server on port 3000, so
both must be running at the same time. See `docs/running-frontend-locally.md`
for a full walkthrough of each tab and what you can test there.

### 8. Import QBO mappings

After browser OAuth succeeds, the frontend Auth tab automatically imports
QBO accounts, items, and customers.

You can also retry this manually from the Mappings tab. To pull accounts,
items, and customers from your QBO sandbox:

```bash
curl -X POST http://localhost:3000/sync/mappings/import \
  -H "Authorization: Bearer $(grep API_KEY .env | cut -d= -f2)"
```

This must be done before pushing any invoices. For initial testing
without per-line item mapping, set these two shortcuts in `.env`
(sandbox only — never use in production):

- `QB_DEFAULT_CUSTOMER_ID` — bypasses CustomerMap lookup; use a QBO
  customer ID (short numeric string like `"28"`) from `GET /sync/mappings`
  → `.customers[0].qboCustomerId`
- `QB_DEFAULT_ITEM_ID` — used when line items have no `internalItemCode`;
  find a valid item ID by checking `GET /sync/mappings` after import and
  copying any `.items[0].qboItemId`

If you get a `502 QBO token refresh failed` error, open the frontend Auth tab
and click **Reconnect QBO** to get fresh tokens, then retry. If the frontend
is not available, run `pnpm qbo-auth` as a fallback (stop `pnpm dev` first —
both use port 3000).

---

## Running Tests

### Unit tests

```bash
pnpm test
```

Covers: conflict detection engine, field-level rule evaluation, retry
state transitions, AES-256-GCM encryption/decryption, stale event
rejection, partially-paid invoice guard, void/delete handling.
No DB, no QBO API, no Redis — all ports are mocked.

### Integration tests

```bash
pnpm test:integration
```

Requires Docker Compose running. Uses a real test database and a mocked
QBO HTTP server (msw). Covers full sync round-trips: create → push →
SyncLink created, duplicate webhook deduplication, conflict detection
and resolution, timeout-after-write recovery, payment sync, partially
paid invoice blocking.

---

## Environment Variables

```env
# Service
NODE_ENV=development
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/invoice_sync
PORT=3000

# QBO OAuth
QB_CLIENT_ID=               # from QBO developer portal
QB_CLIENT_SECRET=           # from QBO developer portal
QB_REDIRECT_URI=            # http://localhost:3000/auth/qbo/callback (dev) or https://<domain>/auth/qbo/callback (prod)
QB_ENVIRONMENT=sandbox      # sandbox | production
QB_REALM_ID=                # QBO company ID (shown after OAuth)
QB_WEBHOOK_VERIFIER_TOKEN=  # from QBO developer portal webhook settings
QB_DEFAULT_CUSTOMER_ID=     # sandbox only — bypasses CustomerMap lookup
QB_DEFAULT_ITEM_ID=         # sandbox only — used when line items have no internalItemCode

# Token encryption
TOKEN_ENCRYPTION_KEY=       # 32-byte hex: openssl rand -hex 32

# API auth
API_KEY=                    # shared secret for Bearer token on all sync endpoints
FRONTEND_URL=               # http://localhost:5173 (dev) or https://<domain> (prod); defaults to / if unset

# Redis
REDIS_URL=redis://localhost:6379
REDIS_PASSWORD=             # required in production

# Sync behaviour
RECONCILIATION_INTERVAL_MINUTES=15
SYNC_JOB_MAX_RETRIES=3
QBO_RATE_LIMIT_MAX=2        # QBO API calls/second — keep at 2 for sandbox (150 req/min cap)
```

---

## API Reference

All endpoints except `GET /health`, `POST /webhooks/qbo`, and
`GET /auth/qbo/callback` require:
`Authorization: Bearer <API_KEY>`

For browser navigation to QBO, `GET /auth/qbo/start` also accepts the API
key as `?apiKey=...`; other protected routes do not accept query-string
API keys.

### Health

- `GET /health` — liveness check

### Auth

- `GET /auth/qbo/status` — returns QBO credential validity, expiry,
  and refresh token warning. Requires API key.
- `GET /auth/qbo/start` — initiates the browser OAuth flow; redirects to
  QBO consent page. Requires API key via `?apiKey=` query param.
- `GET /auth/qbo/callback` — OAuth callback from QBO; exchanges code for
  tokens, saves them, redirects to `FRONTEND_URL?auth=success` (or
  `?auth=error&message=...` on failure). No API key required.

### Webhooks

- `POST /webhooks/qbo` — QBO change notifications (HMAC verified)

### Sync Status

- `GET /sync/links` — list SyncLink records (`?syncStatus=&limit=`)
- `GET /sync/links/:id` — detail with AuditLog entries

### Conflict Resolution

- `GET /sync/conflicts` — list invoices in CONFLICT status
- `POST /sync/conflicts/:id/resolve` — resolve with
  `{ "strategy": "accept-internal" | "accept-qbo" }`

### Initial Load

- `POST /sync/initial-load/internal-to-qbo` — push all unlinked
  internal invoices to QBO (idempotent)
- `POST /sync/initial-load/qbo-to-internal` — not implemented,
  returns 501 (see DESIGN.md)

### Mappings

- `POST /sync/mappings/import` — import accounts, items, customers
  from QBO
- `GET /sync/mappings` — list current mapping tables

---

## Assumptions

- Both systems expose APIs and emit webhook-like change notifications.
- Webhook payloads are minimal (entity type + id only) — the service
  always refetches the full entity from QBO before processing.
- Events may be duplicated, delayed, or arrive out of order — the
  service handles all three explicitly.
- A single QBO company per deployment (single-tenant).
- Internal invoice deletes are treated as voids in QBO. QBO has no
  un-void API, so restore-from-delete is not supported.
- The internal system sets `DocNumber = internalId` on all outbound
  pushes. This is the key used to find existing QBO invoices on retry
  after a timeout-before-write.
- QBO rate limits apply: sandbox cap is ~150 req/min.
  `QBO_RATE_LIMIT_MAX` defaults to 2/second to stay within that cap.
- `TOKEN_ENCRYPTION_KEY` is managed out of band and never stored in
  the database. Rotation requires manual re-encryption.
- If the service is inactive for more than 100 days, the QBO refresh token
  expires. Re-authenticate via the frontend Auth tab (**Reconnect QBO**) or,
  if the frontend is unavailable, by running `pnpm qbo-auth` (stop `pnpm dev`
  first).

---

## Design

See [DESIGN.md](./DESIGN.md) for the full design write-up: data model,
sync engine, idempotency, conflict detection, failure handling, and
tradeoff reasoning.

---

## Deploying to Railway

1. Push repo to GitHub
2. Create new Railway project → "Deploy from GitHub repo"
3. Add Postgres plugin and set the app service `DATABASE_URL` to the Postgres reference variable.
4. Set `REDIS_URL` to an external Redis URL, such as Upstash/Redis Cloud. BullMQ requires a `redis://` or `rediss://` URL, not an HTTP REST URL.
5. Set env vars (QB_CLIENT_ID, QB_CLIENT_SECRET, QB_REALM_ID, QB_WEBHOOK_VERIFIER_TOKEN, QB_REDIRECT_URI, TOKEN_ENCRYPTION_KEY, API_KEY, QB_ENVIRONMENT=sandbox).
6. For a single-service demo deploy, set `RUN_WORKERS_IN_WEB=true` so BullMQ workers run inside the web process. For production, prefer a separate worker process and leave it `false`.
7. The Railway start command runs `pnpm migrate` before starting the server.
8. Set `QB_REDIRECT_URI=https://<web>.railway.app/auth/qbo/callback` and `FRONTEND_URL=https://<web>.railway.app` in Railway env vars, then open the app's Auth tab and click **Reconnect QBO** to complete the OAuth flow in the browser. On success, the frontend imports QBO mappings automatically.
9. Set QBO webhook endpoint to `https://<web-service>.railway.app/webhooks/qbo`.

---

## Debugging

**Sync failures:** check `GET /sync/links?syncStatus=ERROR` to list failed
records. `GET /sync/links/:id` returns the full AuditLog for that link —
each entry shows the action taken, the result, and the error message if
the job failed.

**Auth errors:** if sync jobs are all failing or QBO API calls are
returning 401, check `GET /auth/qbo/status`. It returns token expiry,
refresh token expiry, and a warning flag if the refresh token is within
14 days of the 100-day cliff.

**CONFLICT records:** `GET /sync/conflicts` lists all invoices blocked
by a conflict. Resolve via `POST /sync/conflicts/:id/resolve` with
`{ "strategy": "accept-internal" | "accept-qbo" }`.
