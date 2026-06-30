# Invoice Sync Service

A backend service that syncs invoices, payments, and general ledger
accounts bidirectionally between an internal invoicing system and
QuickBooks Online (QBO).

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

### 2. Start infrastructure

```bash
docker compose up -d
```

Starts PostgreSQL and Redis locally.

### 3. Configure environment

```bash
cp .env.example .env
```

Fill in all values. See Environment Variables below.

### 4. Run database migrations

```bash
pnpm prisma migrate dev
```

### 5. Authenticate with QuickBooks

Run the one-time OAuth flow:

```bash
pnpm tsx scripts/qbo-auth.ts
```

Follow the printed URL, complete the OAuth consent, and paste the
redirect URL back into the terminal. Tokens are encrypted and stored
in the database automatically.

### 6. Import QBO mappings

Before pushing any invoices, import the mapping tables:

```bash
curl -X POST http://localhost:3000/sync/mappings/import \
  -H "Authorization: Bearer $API_KEY"
```

This populates AccountMap, ItemMap, and CustomerMap from your
QBO sandbox. Must be run before the first invoice push.

Sandbox shortcut: set `QB_DEFAULT_CUSTOMER_ID` in `.env` to skip
customer mapping during initial testing. Never use this in production.

### 7. Start the service

```bash
# Development (with watch)
pnpm dev

# Production
pnpm build && pnpm start
```

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

### Sandbox tests (real QBO API)

```bash
pnpm test:sandbox
```

Requires valid `QB_*` env vars pointing to a live sandbox account.
Not run in CI — run manually before submission.

Covers: full invoice lifecycle (create → update → void) against real
QBO API, payment creation and linkage, webhook delivery, token refresh
under real OAuth flow, account/item/customer import.

---

## Webhook Setup

QBO webhooks require a public URL. For local development:

```bash
ngrok http 3000
```

Set the ngrok URL as your webhook endpoint in the QBO developer portal:
`https://<ngrok-id>.ngrok.io/webhooks/qbo`

Copy the Verifier Token from the portal into `QB_WEBHOOK_VERIFIER_TOKEN`.

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
QB_REDIRECT_URI=            # OAuth callback — only needed for qbo-auth.ts script
QB_ENVIRONMENT=sandbox      # sandbox | production
QB_REALM_ID=                # QBO company ID (shown after OAuth)
QB_WEBHOOK_VERIFIER_TOKEN=  # from QBO developer portal webhook settings
QB_DEFAULT_CUSTOMER_ID=     # sandbox only — bypasses CustomerMap lookup

# Token encryption
TOKEN_ENCRYPTION_KEY=       # 32-byte hex: openssl rand -hex 32

# API auth
API_KEY=                    # shared secret for Bearer token on all sync endpoints

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

All endpoints except `POST /webhooks/qbo` require:
`Authorization: Bearer <API_KEY>`

**Health**

- `GET /health` — liveness check

**Auth**

- `GET /auth/qbo/status` — returns QBO credential validity, expiry,
  and refresh token warning

**Webhooks**

- `POST /webhooks/qbo` — QBO change notifications (HMAC verified)

**Sync Status**

- `GET /sync/links` — list SyncLink records (`?syncStatus=&limit=`)
- `GET /sync/links/:id` — detail with AuditLog entries

**Conflict Resolution**

- `GET /sync/conflicts` — list invoices in CONFLICT status
- `POST /sync/conflicts/:id/resolve` — resolve with
  `{ "strategy": "accept-internal" | "accept-qbo" }`

**Initial Load**

- `POST /sync/initial-load/internal-to-qbo` — push all unlinked
  internal invoices to QBO (idempotent)
- `POST /sync/initial-load/qbo-to-internal` — not implemented,
  returns 501 (see Tradeoffs)

**Mappings**

- `POST /sync/mappings/import` — import accounts, items, customers
  from QBO
- `GET /sync/mappings` — list current mapping tables

---

## Architecture

Modular monolith. One Fastify process with strict internal boundaries:

```
domain/         — Invoice/Payment types, port interfaces (no external deps)
application/    — Use-cases, sync engine, conflict rules
infrastructure/ — Prisma, QBO adapter, BullMQ workers, HTTP routes
shared/         — AppError subclasses
```

**Sync model:** all outbound changes use a reconcile job
(`jobId: reconcile-${internalId}`). The worker reads current invoice
state at execution time and decides the QBO operation — never typed
jobs. This prevents jobId collisions and state races when multiple
changes arrive for the same invoice.

**Loop prevention:** after a push to QBO, the worker stores QBO's
`MetaData.LastUpdatedTime` in `SyncLink.qboUpdatedAt`. When QBO fires
a webhook in response, the pull worker compares timestamps and drops
the event as stale. The pull path writes directly to the DB repository
and never calls the invoice use-case — calling the use-case would
enqueue a reconcile job for every inbound change.

**Idempotency:** BullMQ jobId deduplication collapses concurrent
changes into one job. EventLog unique constraint on `eventId` is the
webhook deduplication guard. Find-or-link on duplicate QBO errors
prevents double-creation on retries.

**Payment idempotency:** `PaymentSyncLink` has no `version` field and
no `PROCESSING` state. Payments are append-only in QBO — there is no
update path, so no concurrent-worker race exists on payment records. A
`findByInternalId` pre-check before writing is sufficient. If two
workers race past the check simultaneously, the duplicate QBO error is
caught and resolved via `PaymentRefNum` lookup. Optimistic locking would
add schema and code complexity without protecting against any real
failure mode.

**Void handling:** the pull worker handles void/delete events with three
explicit branches before making any QBO API call. If the internal
invoice is missing (SyncLink exists but invoice was deleted from the
internal DB) — sets `ERROR` with audit action `void_internal_not_found`.
If the invoice is already voided — sets `SYNCED` with audit action
`skipped_already_voided` (idempotent, no write). Otherwise — saves the
invoice with `status: void` directly to the repository, bypassing the
use-case to prevent enqueuing a reconcile job.

---

## Known Limitations

- **Single-tenant only.** One QBO company per deployment.
- **QBO rate limits.** Sandbox cap is ~150 req/min. `QBO_RATE_LIMIT_MAX`
  defaults to 2/second (120/min). Raise to 8 for production
  (500 req/min cap).
- **`TOKEN_ENCRYPTION_KEY` rotation** requires manual re-encryption:
  decrypt with old key → re-encrypt with new key → update DB → update
  env var. Downtime required.
- **Refresh token cliff.** Inactive for >100 days → refresh token
  expires → re-run `scripts/qbo-auth.ts`. No automatic recovery.
- **Customer mapping required before first push.** Run
  `POST /sync/mappings/import` first. Use `QB_DEFAULT_CUSTOMER_ID`
  in sandbox to bypass.

- **No soft-delete support.** Internal deletes are treated as QBO
  voids. QBO has no un-void API — restore-from-delete is not supported.
- **Partially-paid invoice guard blocks only financial fields.** When an
  invoice has linked payments, the reconcile worker blocks changes to
  `lineItems` and `totalAmount` only — QBO rejects those on invoices
  with applied payments. Changes to other fields (`dueDate`, `currency`,
  `status`, memo) are allowed through and pushed to QBO normally. The
  guard only activates when `lastSyncedSnapshot` is set; invoices with
  no prior sync snapshot skip the guard.
- **Application layer imports infrastructure types.** `payment-sync.use-case.ts`
  and `pull.use-case.ts` import structural repository types from
  `infrastructure/database/` for their `Deps` type definitions. These
  are type-only imports — no concrete infrastructure code executes in
  the application layer. The strict approach would define port interfaces
  for every repository in `domain/`, which is the intended production
  architecture but was deferred to keep scope manageable.
- **Same-second timestamp precision.** Two QBO edits within the same
  second: the second webhook is dropped as stale. The reconciliation
  job does not recover this (record shows SYNCED). Rare in practice
  for accounting workflows.

---

## Tradeoffs

**Why qbo-to-internal initial load is not implemented**

The feature requires: paginated QBO fetch (1000 records/page),
DocNumber matching against internal IDs, a background job returning
202 immediately, and per-invoice transactions. DocNumber is also
user-editable in QBO — if overwritten, the match silently fails and
creates a duplicate. This complexity, combined with the risk of
mis-linkage, makes it the highest-effort feature relative to
evaluation signal. The internal-to-qbo direction and the ongoing
webhook-driven sync fully demonstrate the core bidirectional
architecture. The intended design: paginate QBO invoices, match each by DocNumber
against internal IDs, create a SyncLink for matches and a new internal Invoice
for unmatched records, run as a background job returning 202 Accepted immediately.

**Why AES-256-GCM encryption was kept**

The suggestion to store tokens in plaintext was considered and rejected.
These are real OAuth tokens for a real QBO sandbox company. Storing
them in plaintext in a database — even a local dev one — is a genuine
security risk that is trivially avoided. Node's crypto module
implementation is ~20 lines and is not a meaningful time cost.

**Why typed outbound jobs were replaced with the reconcile model**

Typed jobs (`type: "push"`, `type: "void"`) cause two problems: jobId
collision (a push and a void for the same invoice share the same
internalId, so BullMQ silently drops one) and state races (a job
queued as "push" may execute after the invoice was voided, sending a
stale operation to QBO). The reconcile model eliminates both: one job
per invoice, worker reads current state at execution time.

**Why accept-internal/accept-qbo instead of field-level custom resolution**

A custom strategy requires per-field validation, partial application
logic, and a schema that must be kept in sync with the Invoice type.
accept-internal and accept-qbo cover the real-world cases for a
billing integration — accountants either want their version or the
internal system's version, rarely a field-by-field merge. The conflict
rules config handles automated field-level merging for known patterns;
manual resolution is the fallback for genuinely ambiguous cases.

**Why BullMQ jobId deduplication is not sufficient alone**

BullMQ's jobId deduplication prevents duplicate waiting jobs. It does
not prevent a new change from being silently discarded while a job for
the same invoice is active (executing). In this case the change is
lost until the reconciliation job re-queues it (~15 minutes later).
Production would add a post-sync check (`invoice.updatedAt >
jobStartedAt` → re-enqueue before exiting), but this is deferred as
the reconciliation job provides acceptable recovery for this use case.

**Why an in-process mutex instead of a Redis distributed lock for token refresh**

`getValidAccessToken()` uses a `refreshPromise` field on the `QBOClient`
singleton to ensure only one OAuth refresh runs at a time within the
process. Without it, concurrent jobs hitting an expiring token
simultaneously would each trigger a separate Intuit OAuth call with the
same refresh token — Intuit refresh tokens are one-time-use, so the
second call would fail or produce a token immediately overwritten by the
first. A Redis `NX` lock would be required for multi-worker deployments,
but adds TTL management and lock-release complexity that is
disproportionate to this single-worker architecture. A production multi-worker deployment
would replace this with a Redis SET NX PX lock on a shared key,
with a TTL slightly longer than the Intuit refresh call timeout.

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
