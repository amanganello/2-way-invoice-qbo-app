# Design Write-Up — Invoice Sync Service

## Overview

A single-tenant service that keeps invoices, payments, and general ledger
accounts in sync between an internal system and QuickBooks Online (QBO).
Changes flow in both directions: internal changes are pushed to QBO via a
durable job queue; QBO changes arrive via webhook and are pulled into the
internal system.

Stack: Node.js 24 · TypeScript · Fastify · PostgreSQL · Prisma · BullMQ ·
Redis

---

## Architecture

Modular monolith — one Fastify process with strict internal boundaries:

```text
domain/         — Invoice/Payment types, port interfaces (no external deps)
application/    — Use-cases, sync engine, conflict rules
infrastructure/ — Prisma, QBO adapter, BullMQ workers, HTTP routes
shared/         — AppError subclasses
```

The dependency direction is one-way: `infrastructure` depends on
`application`, which depends on `domain`. The domain layer imports nothing
from infrastructure or external libraries except Zod.

---

## Data Model

### Invoice mapping

`SyncLink` is a join record between an internal `Invoice.id` and a QBO
Invoice Id. It carries:

- `qboId` — QBO's identifier for the invoice
- `qboSyncToken` — QBO's optimistic concurrency token; must be passed on
  every update call or QBO rejects it. Cached here to avoid a GET before
  every PUT.
- `lastSyncedSnapshot` — full invoice state at the last successful sync;
  baseline for field-level conflict detection
- `qboUpdatedAt` — QBO's `MetaData.LastUpdatedTime` at last sync; used to
  detect and discard stale webhook events
- `version` — internal optimistic lock; incremented on every write;
  used in `WHERE version = :v` to prevent concurrent workers from racing
- `syncStatus` — state machine: `PENDING → PROCESSING → SYNCED | ERROR | CONFLICT`

### Payment mapping

`PaymentSyncLink` maps internal `Payment.id` to QBO Payment Id. Payments
are immutable in QBO (no update API), so the sync is append-only. No
snapshot needed — payments never conflict. Stores `invoiceInternalId` as
an indexed invoice reference so the partially-paid guard can look up
payments by invoice without a cross-table scan. The current schema keeps
this as an indexed string, not a Prisma foreign key.

### GL account and item mapping

QBO requires each invoice line to reference a QBO Item (`ItemRef`) and
income account. Three lookup tables are populated via
`POST /sync/mappings/import`:

- `AccountMap` — `internalAccountCode` → `qboAccountId`
- `ItemMap` — `internalItemCode` → `qboItemId` + default tax code
- `CustomerMap` — `internalCustomerId` → `qboCustomerId`

Missing mapping at sync time → job fails with a descriptive error, sets
`syncStatus: ERROR`. No silent fallbacks in production.

---

## Sync Engine

### Internal → QBO (reconcile model)

All outbound invoice operations (create, update, void) use a single
**reconcile job**: `queue.add('reconcile', { internalId }, { jobId: 'reconcile-${internalId}' })`.

The job carries no operation type. The worker reads current invoice state
at execution time and decides what QBO operation to perform.

**Why not typed jobs?**
Typed jobs (`type: "push"`, `type: "void"`) cause two problems:

1. *JobId collision* — a push and a void for the same invoice share the
   same `internalId`; BullMQ would silently drop one.
2. *State race* — a job queued as "push" may execute after the invoice
   was voided, sending a stale operation to QBO.

The reconcile model eliminates both: one job per invoice, worker always
reads current state.

**Worker decision tree:**

```text
read current invoice state
├── status !== void AND no SyncLink  → createInvoice
├── status !== void AND SyncLink     → updateInvoice (with qboSyncToken)
├── status === void AND SyncLink     → voidInvoice
└── status === void AND no SyncLink  → no-op, write AuditLog only
```

### QBO → Internal (webhook → pull)

The webhook handler is intentionally thin:

1. Verify HMAC-SHA256 signature (`intuit-signature` header) → 401 if invalid
2. Check Redis availability → 503 if down (never 200 when the job wasn't enqueued)
3. Enqueue a pull job with job id `pull-${eventId}`. `eventId` includes
   entity type, entity id, and QBO `lastUpdated`, so distinct updates for
   the same invoice are not collapsed.
4. Insert `EventLog` with `skipDuplicates: true` — unique constraint on
   `eventId` is the durable deduplication guard. If 0 rows are inserted,
   the event was already recorded; the redundant enqueue is safe because
   the BullMQ job id is deterministic.
5. Return 200

The worker refetches the full entity from QBO (webhooks carry only the
entity id, not the payload), checks for staleness, runs conflict
detection, and writes the result.

**Loop prevention:** after a successful push to QBO, the worker stores
QBO's `MetaData.LastUpdatedTime` in `syncLink.qboUpdatedAt`. When QBO
fires a webhook in response, the pull worker compares timestamps. If
`entity.LastUpdatedTime ≤ qboUpdatedAt` → stale, skip. The pull path
also writes directly to the database repository and never calls the
invoice use-case — calling the use-case would re-enqueue a reconcile
job for every inbound QBO change, creating an infinite push/pull loop.

---

## Idempotency

Three independent layers:

1. **BullMQ jobId deduplication** — concurrent internal changes to the
   same invoice collapse into one `reconcile-${internalId}` job.
2. **EventLog unique constraint on `eventId`** — duplicate webhook
   deliveries are recorded once. The route enqueues before writing
   `EventLog` so a queue failure does not commit a dedup row and cause
   QBO retries to be ignored. Pre-check reads are insufficient under
   concurrent delivery; the DB constraint is the real guard.
3. **Find-or-link on duplicate create** — if `createInvoice` returns a
   duplicate error from QBO, the worker searches QBO by `DocNumber`
   (= `internalId`), links the existing record, and treats as success.
   Prevents double-creation on retries after a timeout-after-write.

---

## Conflict Detection & Resolution

Detection is field-level, not record-level. Before applying a QBO-originated
invoice change:

1. Compute which fields changed on the QBO side (QBO payload vs.
   `lastSyncedSnapshot`)
2. Compute which fields changed internally (current invoice vs.
   `lastSyncedSnapshot`)
3. For each field changed on **both** sides, check the conflict rule:
   - `"internal"` or `"qbo"` → auto-resolve (take that side)
   - `"manual"` → stop, set `syncStatus: CONFLICT`, write AuditLog

Fields changed on only one side are never a conflict.

**Conflict rules** (`src/application/sync/conflict-rules.ts`):

```ts
export const conflictRules = {
  status: "qbo",        // accountants own status in QBO
  lineItems: "internal",
  totalAmount: "qbo",   // computed by QBO — cannot be set independently
  dueDate: "manual",    // requires human resolution
  currency: "internal",
  customerId: "internal",
}
```

**Resolution:** `POST /sync/conflicts/:id/resolve` with
`{ strategy: "accept-internal" | "accept-qbo" }`. The custom per-field
strategy was omitted — accept-internal and accept-qbo cover the
real-world cases for a billing integration. A field-by-field merge would
require per-field validation and partial application logic
disproportionate to its value here.

---

## Reliability & Failure Handling

**Process integrity:** the error handler distinguishes operational errors
(`AppError.isOperational = true` — expected failures like missing mappings,
QBO faults, or external service errors) from non-operational ones (programmer
bugs that reach the catch-all). Non-operational errors log as `fatal` and
set a process-level `isHealthy` flag to `false`. The `/health` endpoint
returns 503 when unhealthy, letting an orchestrator detect the failure and
restart the container cleanly without killing in-flight requests or active
queue jobs mid-execution. Unhandled promise rejections outside the request
lifecycle are caught by `process.on('unhandledRejection')`, logged as
`fatal` through Pino, then exit. All `ExternalServiceError` instances are
`isOperational = true` — QBO API failures are expected failure modes, not
programmer bugs, and should never mark the process unhealthy.

**Retries:** BullMQ retries failed jobs 3 times with exponential backoff
(5s → 30s → 5min). On exhaustion, `syncStatus` is set to `ERROR` and an
`AuditLog` entry is written with the error detail.

**Reconciliation job (safety net):** runs every 15 minutes. First runs a
watchdog: resets `SyncLink` records stuck in `PROCESSING` for more than
10 minutes (crashed worker recovery) to `ERROR`. Then re-queues all
`PENDING` and `ERROR` records. `CONFLICT` records are never re-queued —
they require human resolution.

**Optimistic locking:** every SyncLink write uses `WHERE version = :v`.
If the version check fails, another worker owns the record and the
current job exits silently. This prevents two concurrent workers from
applying conflicting updates to the same SyncLink.

**Partially paid invoice guard:** before pushing an invoice update to QBO,
the worker queries `PaymentSyncLink WHERE invoiceInternalId = :id`. If
payments exist and `lastSyncedSnapshot` is set, changes to `lineItems`
or `totalAmount` are blocked with a `ConflictError`. QBO rejects these
fields on invoices with applied payments; blocking them before the
API call surfaces a clear error rather than a cryptic QBO rejection.

**Token refresh mutex:** `getValidAccessToken()` uses an in-process
`refreshPromise` field on the `QBOClient` singleton. Without it,
concurrent jobs hitting an expiring token would each trigger a separate
OAuth refresh. Intuit refresh tokens are one-time-use — the second call
fails or produces a token that is immediately overwritten. The mutex
ensures only one refresh runs at a time within the process.

---

## Auditability

Every sync action (create, update, void, conflict, skip) writes an
`AuditLog` entry with: `internalId`, `action`, `result`
(`success | error | conflict | skipped`), `errorMessage`, and
`beforeState`/`afterState` for conflicts. The audit log is append-only
and accessible via `GET /sync/links/:id`.

---

## What Was Not Implemented

**`qbo-to-internal` initial load** — returns 501. The intended design:
paginate QBO invoices, match each by `DocNumber` against internal IDs,
create a `SyncLink` for matches and a new internal `Invoice` for
unmatched records, run as a background job returning `202 Accepted`.
Not implemented because `DocNumber` is user-editable in QBO — if
overwritten, the match silently fails and creates a duplicate. This risk,
combined with the pagination and transaction handling required, makes it
the highest-effort feature relative to evaluation signal. The
`internal-to-qbo` direction and webhook-driven sync fully demonstrate
the bidirectional architecture.

**Distributed token refresh lock** — the in-process mutex is sufficient
for a single-worker deployment. Multi-worker deployments would need a
Redis `SET NX PX` lock to coordinate across processes.

**Post-sync change check** — BullMQ's jobId deduplication only prevents
duplicate jobs in `waiting` state. A change arriving while a job is
`active` is silently dropped; the reconciliation job recovers it within
15 minutes. Production would add a `invoice.updatedAt > jobStartedAt`
check and re-enqueue before exiting.
