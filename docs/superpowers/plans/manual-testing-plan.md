# Manual Testing Plan — Invoice Sync Service

Walk through these scenarios in order. Each section lists prerequisites,
exact commands, and what to verify. Run setup once; each scenario is
independent after that.

---

## 0. Environment Setup

Complete the full setup from README steps 1–8 before running any scenario.

**Start the required processes** (three separate terminals):

```bash
# Terminal 1 — infrastructure (if not already running)
docker compose up -d postgres redis
```

```bash
# Terminal 2 — HTTP server
pnpm dev
# Wait for: "Server listening at http://0.0.0.0:3000"
```

```bash
# Terminal 3 — Queue worker (required for all sync scenarios)
pnpm worker
# Wait for: "Workers started"
```

Without the worker, invoices will be created in the DB but no jobs will
be processed — QBO calls, pulls, and reconciliation will never run.

**Verify everything is ready:**

```bash
# Infrastructure running
docker compose ps
# postgres and redis should both show "running"

# Migrations applied
pnpm prisma migrate status
# Should show "All migrations have been applied"

# Service responding
curl -s http://localhost:3000/health | jq
# { "status": "ok" }
```

**Export your API key** so you don't repeat it in every command:

```bash
export API_KEY=$(grep ^API_KEY .env | cut -d= -f2)
```

---

## 1. Health Check

**What it tests:** the service is up and Fastify is routing correctly.

```bash
curl -s http://localhost:3000/health | jq
```

**Expected:**
```json
{ "status": "ok" }
```

No auth header required.

---

## 2. QBO Auth Status

**What it tests:** OAuth tokens are stored and valid.

```bash
curl -s http://localhost:3000/auth/qbo/status \
  -H "Authorization: Bearer $API_KEY" | jq
```

**Expected:**
```json
{
  "valid": true,
  "expiresAt": "...",
  "refreshTokenExpiresAt": "...",
  "refreshTokenExpiringSoon": false
}
```

If `valid` is `false`, re-authenticate: open the frontend at
`http://localhost:5173`, go to the **Auth** tab, and click **Reconnect QBO**.
The browser completes the OAuth flow and redirects back with a success
confirmation. If the frontend is unavailable, stop `pnpm dev` first and
run `pnpm qbo-auth` as a fallback.

If `refreshTokenExpiringSoon` is `true`, the refresh token has <14 days
remaining — note the warning but it doesn't block testing.

---

## 3. Import QBO Mappings

**What it tests:** AccountMap, ItemMap, and CustomerMap are populated
from QBO.

```bash
curl -s -X POST http://localhost:3000/sync/mappings/import \
  -H "Authorization: Bearer $API_KEY" | jq
```

**Expected:**
```json
{
  "accountsImported": <N>,
  "itemsImported": <N>,
  "customersImported": <N>
}
```

All counts should be > 0. Then verify the maps are readable:

```bash
curl -s http://localhost:3000/sync/mappings \
  -H "Authorization: Bearer $API_KEY" | jq '(.accounts | length), (.items | length), (.customers | length)'
```

**Verify in DB (optional):**
```bash
pnpm prisma studio
# Open AccountMap, ItemMap, CustomerMap tables and confirm rows exist
```

---

## 4. Create Invoice → Push to QBO → SyncLink Created

**What it tests:** the full outbound create path. Internal invoice →
reconcile job → QBO create → SyncLink written.

**Step 1 — Create an invoice via the internal API:**

You need a valid `customerId` that exists in your internal DB and has
a CustomerMap entry. If you set `QB_DEFAULT_CUSTOMER_ID`, any string works.

```bash
curl -s -X POST http://localhost:3000/invoices \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "cust-001",
    "lineItems": [
      { "description": "Consulting services", "quantity": 2, "unitPrice": 150, "amount": 300 },
      { "description": "Support hours",       "quantity": 1, "unitPrice": 200, "amount": 200 }
    ],
    "totalAmount": 500,
    "currency": "USD",
    "status": "sent",
    "dueDate": "2030-01-01"
  }' | jq
```

Save the returned `id` as `INVOICE_ID`.

**Step 2 — Wait for the reconcile worker (~2s) then check SyncLink:**

```bash
curl -s "http://localhost:3000/sync/links?syncStatus=SYNCED" \
  -H "Authorization: Bearer $API_KEY" | jq '.[0]'
```

**Expected:**
```json
{
  "internalId": "<INVOICE_ID>",
  "qboId": "<QBO invoice ID>",
  "syncStatus": "SYNCED",
  "qboSyncToken": "0"
}
```

**Verify in QBO:** log into your sandbox company and confirm the invoice
appears in the invoice list.

---

## 5. Update Invoice → Push Updated Fields to QBO

**Prerequisite:** Scenario 4 completed, `INVOICE_ID` is synced.

**Step 1 — Update the invoice's due date:**

> Note: `totalAmount` is computed by QBO from line items and cannot be
> updated independently. Change `dueDate` or other editable fields instead.

```bash
curl -s -X PATCH "http://localhost:3000/invoices/$INVOICE_ID" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "dueDate": "2031-06-01" }' | jq
```

**Step 2 — Wait for the reconcile worker (~2s) then verify:**

```bash
SYNC_LINK_ID=$(curl -s "http://localhost:3000/sync/links?syncStatus=SYNCED" \
  -H "Authorization: Bearer $API_KEY" | jq -r '.[0].id') && echo "SYNC_LINK_ID: $SYNC_LINK_ID"

curl -s "http://localhost:3000/sync/links/$SYNC_LINK_ID" \
  -H "Authorization: Bearer $API_KEY" | jq '.qboSyncToken, .syncStatus'
```

**Expected:** `qboSyncToken` should be `"1"` (incremented from `"0"`)
and `syncStatus` should be `"SYNCED"`.

**Verify in QBO:** the invoice in your sandbox should show the updated due date.

---

## 6. Void Invoice → QBO Void Called

**Prerequisite:** Scenario 4 completed. If you did Scenario 5, save
`INVOICE_ID` as a new invoice — the update already ran on that one.

**Step 1 — Set the invoice status to void:**

```bash
curl -s -X PATCH "http://localhost:3000/invoices/$INVOICE_ID" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "status": "void" }' | jq
```

**Step 2 — Wait ~2s, then check AuditLog:**

```bash
SYNC_LINK_ID=$(curl -s "http://localhost:3000/sync/links" \
  -H "Authorization: Bearer $API_KEY" | \
  jq -r --arg id "$INVOICE_ID" '.[] | select(.internalId == $id) | .id') && echo "SYNC_LINK_ID: $SYNC_LINK_ID"

curl -s "http://localhost:3000/sync/links/$SYNC_LINK_ID" \
  -H "Authorization: Bearer $API_KEY" | jq '.syncStatus, (.auditLogs[] | .action)'
```

**Expected:** `syncStatus: "SYNCED"` and an audit entry with
`action: "void_pushed"`.

**Verify in QBO:** the invoice should show as VOID in the sandbox.

---

## 7. QBO Webhook → Pull Updates to Internal DB

**What it tests:** the inbound path. Simulates QBO firing a webhook
after a change is made directly in the QBO sandbox.

**Prerequisite:** ngrok running and configured in QBO developer portal
(see README Setup step 6).

**Step 1 — Make a change directly in the QBO sandbox UI.** Open your
sandbox company, find the invoice created in Scenario 4, and edit a
field (e.g., change the due date).

**Step 2 — QBO fires a webhook.** Within ~30s, QBO posts a change
notification to your ngrok URL. The worker logs will show:

```
pull job received  qboId=<QBO-ID>
```

**Step 3 — Verify the pull applied:**

```bash
curl -s "http://localhost:3000/sync/links/$SYNC_LINK_ID" \
  -H "Authorization: Bearer $API_KEY" | jq '.syncStatus, .qboUpdatedAt, (.auditLogs[] | select(.action == "pull_applied") | .action)'
```

**Expected:** `syncStatus: "SYNCED"`, `qboUpdatedAt` updated to a recent
timestamp, and an audit entry with `action: "pull_applied"`.

---

## 8. Duplicate Webhook Deduplication

**What it tests:** duplicate webhook deliveries are safe to retry:
EventLog keeps one durable event row, processed duplicates are not
re-enqueued, and interrupted/failed attempts can be retried.

**Simulating a duplicate without ngrok:** send the same webhook payload
twice via curl with the same `eventId`.

First, compute a valid HMAC signature. Get your `QB_WEBHOOK_VERIFIER_TOKEN`
from `.env`:

```bash
VERIFIER_TOKEN=<your-verifier-token>
PAYLOAD='{"eventNotifications":[{"realmId":"test","dataChangeEvent":{"entities":[{"name":"Invoice","id":"QBO-TEST-1","operation":"Update","lastUpdated":"2026-01-01T00:00:00Z"}]}}]}'
SIG=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$VERIFIER_TOKEN" -binary | base64)

# First call
curl -s -X POST http://localhost:3000/webhooks/qbo \
  -H "Content-Type: application/json" \
  -H "intuit-signature: $SIG" \
  -d "$PAYLOAD" | jq

# Second call — same payload, same signature
curl -s -X POST http://localhost:3000/webhooks/qbo \
  -H "Content-Type: application/json" \
  -H "intuit-signature: $SIG" \
  -d "$PAYLOAD" | jq
```

**Expected:** both calls return `{ "ok": true }`. Duplicate handling
happens at multiple layers:

- **EventLog unique constraint**: `skipDuplicates: true` on `createMany`
  means only one durable event row is recorded.
- **Processed duplicate skip**: if the first pull already marked the
  event `PROCESSED`, the second webhook returns 200 without enqueuing
  another pull job.
- **Retryable pending/failed events**: if a previous attempt crashed
  after writing `EventLog` but before/during enqueue, the event remains
  `PENDING` or `FAILED`; a duplicate webhook re-enqueues it.
- **BullMQ jobId dedup**: if a retry arrives while the original pull job
  is still queued or active, the deterministic `jobId` prevents duplicate
  queued jobs.

**Verify in DB:**
```bash
pnpm prisma studio
# EventLog table: confirm only ONE row with eventId "Invoice-QBO-TEST-1-2026-01-01T00:00:00Z"
```

---

## 9. Conflict Detection and Resolution

**What it tests:** when both internal and QBO change the same field
concurrently, the system sets CONFLICT and blocks further processing.

**Prerequisite:** Scenario 4 completed. `SYNC_LINK_ID` is available.

**Step 1 — Change `dueDate` on the internal invoice:**

```bash
curl -s -X PATCH "http://localhost:3000/invoices/$INVOICE_ID" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "dueDate": "2031-06-01" }' | jq
```

**Step 2 — Simultaneously change `dueDate` in QBO sandbox UI** (or
change it before Step 1 so the pull webhook arrives while the reconcile
is pending). The key is that `dueDate` is changed on both sides relative
to `lastSyncedSnapshot`.

**Step 3 — Check sync status:**

```bash
curl -s http://localhost:3000/sync/conflicts \
  -H "Authorization: Bearer $API_KEY" | jq '.[0] | .id, .syncStatus'
```

**Expected:** the SyncLink appears in the conflict list with
`syncStatus: "CONFLICT"`.

**Step 4 — Resolve the conflict:**

```bash
# Accept internal state (internal wins, pushes to QBO)
curl -s -X POST "http://localhost:3000/sync/conflicts/$SYNC_LINK_ID/resolve" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "strategy": "accept-internal" }' | jq
```

Or accept QBO state (no push, marks SYNCED):

```bash
curl -s -X POST "http://localhost:3000/sync/conflicts/$SYNC_LINK_ID/resolve" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "strategy": "accept-qbo" }' | jq
```

**Expected:** `{ "ok": true, "strategy": "accept-internal", "internalId": "..." }`

**Step 5 — Verify it resolved:**

```bash
curl -s "http://localhost:3000/sync/links/$SYNC_LINK_ID" \
  -H "Authorization: Bearer $API_KEY" | jq '.syncStatus'
# accept-internal: "PENDING" (will become SYNCED after worker runs)
# accept-qbo: "SYNCED"
```

---

## 10. Initial Load — Internal to QBO

**What it tests:** bulk-enqueue all unlinked invoices for initial sync.

Create a few invoices without waiting for sync (or use ones that failed
and have no SyncLink):

```bash
curl -s -X POST http://localhost:3000/sync/initial-load/internal-to-qbo \
  -H "Authorization: Bearer $API_KEY" | jq
```

**Expected:**
```json
{
  "enqueued": <N>,
  "skipped": <M>
}
```

`enqueued` = invoices without a SyncLink that were queued.
`skipped` = invoices already linked.

**Verify:** after a few seconds, check that SyncLinks were created:

```bash
curl -s "http://localhost:3000/sync/links?syncStatus=SYNCED" \
  -H "Authorization: Bearer $API_KEY" | jq 'length'
```

---

## 11. Error Recovery — Polling Reconciliation

**What it tests:** the 15-minute reconciliation job re-queues ERROR
and PENDING records.

**Step 1 — Deliberately cause an error.** Temporarily unset
`QB_DEFAULT_CUSTOMER_ID` in `.env` (if set), then create an invoice with
a `customerId` that has no CustomerMap entry. The reconcile job will fail
with a CustomerMap miss.

```bash
curl -s -X POST http://localhost:3000/invoices \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "cust-no-mapping",
    "lineItems": [
      { "description": "Test item", "quantity": 1, "unitPrice": 100, "amount": 100 }
    ],
    "totalAmount": 100,
    "currency": "USD",
    "status": "sent",
    "dueDate": "2030-01-01"
  }' | jq '.id'
```

Wait ~5s for the job to fail after retries.

**Step 2 — Check error status:**

```bash
curl -s "http://localhost:3000/sync/links?syncStatus=ERROR" \
  -H "Authorization: Bearer $API_KEY" | jq '.[0] | .internalId, .syncStatus'
```

**Step 3 — Fix the root cause** (add a CustomerMap entry or set
`QB_DEFAULT_CUSTOMER_ID`) and wait for the next reconciliation cycle
(up to 15 minutes, or restart the worker with
`RECONCILIATION_INTERVAL_MINUTES=1` to speed it up).

**Step 4 — Verify recovery:**

```bash
curl -s "http://localhost:3000/sync/links?syncStatus=SYNCED" \
  -H "Authorization: Bearer $API_KEY" | jq '.[0] | .internalId'
```

The previously-errored invoice should now be SYNCED.

---

## 12. API Key Enforcement

**What it tests:** unauthenticated requests are rejected, exempt routes
are accessible without auth.

```bash
# No auth header — should 401
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/sync/links

# Wrong key — should 401
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/sync/links \
  -H "Authorization: Bearer wrong-key"

# Health is exempt — should 200
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/health

# Webhook is exempt — should 401 (missing HMAC), not because of API key
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/webhooks/qbo \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Expected HTTP codes:** `401`, `401`, `200`, `401` (webhook 401 is
from missing HMAC signature, not API key check).

---

## 13. Payment Sync — Create Payment → Push to QBO

**What it tests:** a payment recorded internally is pushed to QBO and
a `PaymentSyncLink` is created.

**Prerequisite:** Scenario 4 completed. The invoice must be in `SYNCED`
status with a `qboId`. `INVOICE_ID` and `SYNC_LINK_ID` must be set.

**Step 1 — Record a payment against the invoice:**

```bash
PAYMENT_ID=$(curl -s -X POST "http://localhost:3000/invoices/$INVOICE_ID/payments" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 100,
    "currency": "USD",
    "paidAt": "2030-03-01T00:00:00Z"
  }' | jq -r '.id') && echo "PAYMENT_ID: $PAYMENT_ID"
```

**Step 2 — Wait ~3s for the payment-sync worker, then check AuditLog:**

```bash
curl -s "http://localhost:3000/sync/links/$SYNC_LINK_ID" \
  -H "Authorization: Bearer $API_KEY" | jq '(.auditLogs[] | select(.action == "payment_synced_to_qbo") | .action, .afterState)'
```

**Expected:** an audit entry with `action: "payment_synced_to_qbo"` and
`afterState.qboPaymentId` set to the QBO payment ID.

**Verify in QBO:** open the invoice in your sandbox — the payment should
appear in the "Receive Payment" section.

**Step 3 — Verify the PaymentSyncLink in DB:**

```bash
pnpm prisma studio
# Open PaymentSyncLink table: confirm a row with internalId == $PAYMENT_ID
# and syncStatus == "SYNCED"
```

---

## Quick Reference — Checking State

```bash
# All SyncLinks by status
curl -s "http://localhost:3000/sync/links?syncStatus=ERROR" -H "Authorization: Bearer $API_KEY" | jq 'length'
curl -s "http://localhost:3000/sync/links?syncStatus=CONFLICT" -H "Authorization: Bearer $API_KEY" | jq 'length'
curl -s "http://localhost:3000/sync/links?syncStatus=SYNCED" -H "Authorization: Bearer $API_KEY" | jq 'length'

# Detail for a specific link with full audit trail
curl -s "http://localhost:3000/sync/links/<SYNC_LINK_ID>" -H "Authorization: Bearer $API_KEY" | jq '.syncStatus, .auditLogs'

# All conflicts
curl -s http://localhost:3000/sync/conflicts -H "Authorization: Bearer $API_KEY" | jq

# QBO auth health
curl -s http://localhost:3000/auth/qbo/status -H "Authorization: Bearer $API_KEY" | jq
```
