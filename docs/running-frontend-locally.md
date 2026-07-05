# Running the Frontend Locally

The frontend runs as a separate Vite dev server (`:5173`) that proxies API calls to the Fastify backend (`:3000`). You need both running at the same time.

---

## Prerequisites

- All README setup steps completed (`.env` populated, `pnpm install` done, Postgres and Redis available)
- QBO OAuth tokens obtained at least once — either via `pnpm qbo-auth` (initial setup) or the browser Reconnect flow
- Two env vars in your `.env` must match the browser OAuth flow:
  - `QB_REDIRECT_URI=http://localhost:3000/auth/qbo/callback`
  - `FRONTEND_URL=http://localhost:5173`

---

## Step 1 — Start infrastructure

```bash
docker compose up -d postgres redis
```

Verify:

```bash
docker compose ps
# postgres and redis should both show "running"
```

---

## Step 2 — Start the API server

```bash
pnpm dev
```

Wait for:

```
Server listening at http://0.0.0.0:3000
```

---

## Step 3 — Start the queue worker

Open a second terminal:

```bash
pnpm worker
```

Wait for:

```
Workers started
```

The worker is required for any sync operation (create, update, void, initial load) to actually run against QBO.

---

## Step 4 — Start the frontend dev server

Open a third terminal:

```bash
cd client && pnpm dev
```

Wait for:

```
  VITE ready in ...ms

  ➜  Local:   http://localhost:5173/
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## Step 5 — Enter your API key

On first load you'll see an **API key required** prompt. Enter the value of `API_KEY` from your `.env` file:

```bash
grep ^API_KEY .env
```

Paste the value and click **Save**. You can update it anytime via the gear icon (⚙) in the top-right corner.

---

## What each tab does

| Tab | Manual testing scenarios |
|---|---|
| **Invoices** | Create (scenario 4), Update (scenario 5), Void (scenario 6) |
| **Sync Links** | Watch sync status in real time — polls every 5 s. Filter by status. Click a row to see the full audit log. |
| **Conflicts** | Detect and resolve conflicts (scenario 9) — Accept Internal or Accept QBO |
| **Mappings** | Import mappings from QBO (scenario 3), trigger Initial Load (scenario 10) |
| **Auth** | Check QBO OAuth token validity (scenario 2). Click **Reconnect QBO** to re-authenticate without terminal access. |

---

## Tips

**Watch a sync happen end-to-end (scenario 4):**
1. Go to **Invoices** → create an invoice
2. Switch to **Sync Links** — the new row appears as `PENDING`, then `PROCESSING`, then `SYNCED` within a few seconds
3. Click the row to open the audit log drawer and confirm `push_created` was logged

**Trigger an initial load (scenario 10):**
Go to **Mappings** → click **Initial Load**. The result shows how many invoices were enqueued vs. skipped. Switch to **Sync Links** and watch them process.

**Scenarios still requiring `curl`:**
- Scenario 1 (health check) — `curl http://localhost:3000/health`
- Scenario 7 (webhook pull) — make a change directly in the QBO sandbox UI
- Scenario 8 (webhook dedup) — requires HMAC-signed `curl` commands
- Scenario 11 (error recovery) — create an invoice with a bad `customerId` via `curl`, then watch **Sync Links** for the ERROR status
- Scenario 12 (API key enforcement) — use `curl` without or with a wrong `Authorization` header
