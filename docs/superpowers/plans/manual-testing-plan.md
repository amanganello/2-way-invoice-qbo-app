# Manual Testing Plan — Invoice Sync Service

Walk through these scenarios in order using the deployed app on Railway.
No terminal or curl required — everything is done through the UI.

---

## Access

Open the Railway app URL in your browser. On first load you will be
prompted for the API key — paste the value you received and click
**Save**. The key is stored in your browser's `localStorage` and sent
automatically with every request.

The app has five tabs: **Auth**, **Invoices**, **Sync Links**,
**Conflicts**, and **Mappings**.

---

## 1. QBO Auth Status

**Tab:** Auth

**What it tests:** OAuth tokens are stored, valid, and not about to expire.

**Steps:**
1. Open the **Auth** tab.
2. Verify the status table shows **Valid** in green.
3. Confirm that **Access token expires** and **Refresh token expires**
   show future dates.

**Expected:** no red banner, no "Reconnect QBO" warning button visible.

If **Valid** shows red or the banner appears, click **Reconnect QBO**,
complete the browser OAuth flow with the QBO sandbox account, and wait
for the success confirmation before continuing.

---

## 2. QBO Mappings

**Tab:** Mappings

**What it tests:** accounts, items, and customers are imported from QBO
into the local mapping tables. These are required before any invoice can
be pushed.

**Steps:**
1. Open the **Mappings** tab.
2. If the accounts, items, and customer tables are empty, click
   **Import Mappings from QBO**.
3. Wait for the confirmation banner: `Imported: N accounts, N items, N customers`.
4. Verify that at least one row appears in each of the three tables
   (Accounts, Items, Customers).

**Expected:** all three tables have rows. The customer IDs in the
Customers table are the ones you will use when creating invoices.

---

## 3. Create Invoice → Push to QBO → SyncLink Created

**Tab:** Invoices, then Sync Links

**What it tests:** the full outbound create path — internal invoice →
reconcile job → QBO create → SyncLink written.

**Steps:**
1. Open the **Invoices** tab and click **+ Create Invoice**.
2. Fill in the form:
   - **Customer:** select any customer from the dropdown (populated from Mappings).
   - **Status:** `sent`
   - **Due Date:** any future date (e.g. `2030-01-01`)
   - **Line Items:** add at least one line — fill in description, quantity,
     and unit price. Amount auto-calculates.
3. Click **Create**. The modal closes and the new invoice appears in the table
   with a `—` in the Sync column (not yet synced).
4. Wait ~2–3 seconds for the reconcile worker to run.
5. The Sync column updates to a green **SYNCED** badge automatically
   (the page polls every 10s — you may need to wait one poll cycle).
6. Switch to the **Sync Links** tab and click the **SYNCED** filter button.
7. Click the row for your new invoice to open the detail drawer.

**Expected:**
- `qboId` is populated (a short numeric string like `"123"`).
- `syncStatus` is `SYNCED`.
- `qboSyncToken` is `"0"`.
- Audit log shows an entry with action `invoice_created_in_qbo` and result `SUCCESS`.

**Verify in QBO (optional):** log into your QBO sandbox company and
confirm the invoice appears in the Sales → Invoices list.

---

## 4. Update Invoice → Push Updated Fields to QBO

**Tab:** Invoices, then Sync Links

**Prerequisite:** Scenario 3 completed — at least one invoice is SYNCED.

**Steps:**
1. Open the **Invoices** tab. Find the invoice from Scenario 3 and click **Edit**.
2. Change the **Due Date** to a different future date (e.g. `2031-06-01`).
3. Click **Save**.
4. Wait ~2–3 seconds, then switch to the **Sync Links** tab.
5. Click the row for this invoice and open the detail drawer.

**Expected:**
- `syncStatus` is `SYNCED`.
- `qboSyncToken` is `"1"` (incremented from `"0"` — QBO advances the token on every update).
- Audit log shows `invoice_updated_in_qbo` with result `SUCCESS`.

**Verify in QBO (optional):** open the invoice in your sandbox — the due date should match.

---

## 5. Void Invoice → QBO Void Called

**Tab:** Invoices, then Sync Links

**Prerequisite:** Scenario 3 completed. Use the SYNCED invoice (or create a new one).

**Steps:**
1. Open the **Invoices** tab. Find a SYNCED invoice and click **Void**.
2. Confirm in the dialog.
3. The invoice row updates to `void` status. Wait ~2–3 seconds.
4. Switch to **Sync Links** and open the detail drawer for this invoice.

**Expected:**
- `syncStatus` is `SYNCED`.
- Audit log shows `void_pushed` with result `SUCCESS`.
- The **Void** button disappears from the Invoices table row (already voided).

**Verify in QBO (optional):** the invoice should show as VOID in your sandbox.

---

## 6. QBO Webhook → Pull Change to Internal DB

**Tab:** Sync Links

**What it tests:** the inbound path — a change made directly in the QBO sandbox
arrives via webhook, the pull worker applies it internally.

**Prerequisite:** Scenario 3 completed. The service must be running with a QBO
webhook configured (check with whoever set up the deployment).

**Steps:**
1. Log into your QBO sandbox company. Find the invoice created in Scenario 3.
2. Edit a field directly in the QBO UI (e.g. change the memo/note or due date).
3. Save in QBO.
4. Within ~30 seconds, QBO fires a webhook to the Railway service.
5. Switch to the **Sync Links** tab in the app and open the detail drawer for this invoice.

**Expected:**
- `qboUpdatedAt` has updated to a recent timestamp.
- `qboSyncToken` has advanced.
- Audit log shows `pull_applied` with result `SUCCESS`.

---

## 7. Import from QBO (QBO → Internal)

**Tab:** Invoices

**What it tests:** the bulk import endpoint pulls invoices that exist in QBO
but have no local counterpart, and creates them locally with a SYNCED SyncLink.

**Steps:**
1. Open the **Invoices** tab.
2. Click **Import from QBO** (top-right, next to Create Invoice).
3. Wait for the spinner to finish.

**Expected:** a green banner appears:
`Imported N invoice(s) from QBO (M already linked).`

- If this is the first import: `N > 0` and the invoice list grows.
- If all QBO invoices are already linked: `N = 0`, `M > 0` — the import is idempotent.

Switch to **Sync Links** and filter by **SYNCED** to see the newly imported entries.

---

## 8. Conflict Detection and Resolution

**Tab:** Invoices → Sync Links → Conflicts

**What it tests:** when the same field is changed on both sides (internal and QBO)
since the last sync, the system detects the conflict and blocks further processing
until a human resolves it.

**Steps:**
1. Open the **Invoices** tab. Find a SYNCED invoice and click **Edit**.
2. Change the **Due Date** to a new value (e.g. `2032-01-01`) and click **Save**.
   Do **not** wait for the reconcile worker — move quickly.
3. Simultaneously (or just before step 2), edit the same invoice's due date
   directly in the QBO sandbox UI to a **different** value (e.g. `2033-06-01`).
4. The QBO change arrives via webhook; the pull worker detects that `dueDate`
   changed on both sides relative to `lastSyncedSnapshot` → CONFLICT.

   > **Timing tip:** if you can't do both changes at once, do the QBO change
   > first, then edit internally before the webhook is processed. Or you can
   > wait — the reconcile worker will also detect the conflict when it tries
   > to push the internal change while QBO has a newer version.

5. Open the **Conflicts** tab. The invoice should appear in the list with
   the last audit action shown.

**Expected:** the invoice is listed with `syncStatus: CONFLICT`.

**Resolve the conflict:**
- Click **Accept Internal** → the internal due date wins, a reconcile job
  is re-enqueued, the SyncLink transitions to PENDING then SYNCED.
- Or click **Accept QBO** → QBO's due date wins, the SyncLink is marked
  SYNCED immediately with no push.

After resolving, the row disappears from the Conflicts tab. Switch to
**Sync Links** to confirm the status is now SYNCED.

---

## 9. Initial Load — Push All Internal Invoices to QBO

**Tab:** Mappings

**What it tests:** any internal invoices that have no SyncLink are bulk-enqueued
for reconciliation (useful if you created invoices before the worker was running,
or want to re-sync after a reset).

**Steps:**
1. Open the **Mappings** tab.
2. Click **Push Internal Invoices to QBO**.
3. Wait for the result banner.

**Expected:** `Initial load: N enqueued, M skipped`
- `enqueued` = invoices without a SyncLink that were queued.
- `skipped` = invoices already linked (idempotent — safe to run multiple times).

After a few seconds, switch to **Sync Links** and verify the enqueued
invoices transition to SYNCED.

---

## 10. Error State — Missing Customer Mapping

**Tab:** Invoices → Sync Links

**What it tests:** when the reconcile worker can't resolve a customer, the job
fails with a descriptive error, the SyncLink goes to ERROR, and the AuditLog
records the failure reason.

**Steps:**
1. Open the **Invoices** tab and click **+ Create Invoice**.
2. In the **Customer** field, type a free-text value that does not exist in
   the CustomerMap (e.g. `cust-unknown`).
   > The dropdown only shows mapped customers. If it's pre-filled with a
   > dropdown, type a value manually using the text input that appears when
   > no mappings are loaded, or temporarily clear the mappings in Mappings tab.
3. Fill in the rest of the form and click **Create**.
4. Wait ~10–15 seconds for the reconcile worker to exhaust its 3 retries.
5. Switch to **Sync Links** and click the **ERROR** filter.

**Expected:** the new invoice appears with `syncStatus: ERROR`. Open the detail
drawer — the audit log shows `reconcile_failed` with the error message
`No CustomerMap entry for customer: cust-unknown`.

**Recover:**
1. Open the **Mappings** tab and click **Import Mappings from QBO** to refresh
   mappings (or the customer must exist in your QBO sandbox).
2. Wait up to 15 minutes for the reconciliation watchdog to re-queue the ERROR
   record, or re-trigger via **Push Internal Invoices to QBO** in the Mappings tab.
3. The SyncLink should eventually transition to SYNCED.

---

## Quick Reference — What to Look For

| Scenario | Tab | Success signal |
|----------|-----|---------------|
| Auth valid | Auth | Green "Valid" status |
| Mappings loaded | Mappings | Rows in Accounts, Items, Customers |
| Invoice pushed | Sync Links detail | `invoice_created_in_qbo` audit entry |
| Update pushed | Sync Links detail | `qboSyncToken` incremented, `invoice_updated_in_qbo` |
| Void pushed | Sync Links detail | `void_pushed` audit entry |
| QBO change pulled | Sync Links detail | `pull_applied` audit entry |
| Duplicate skipped | Sync Links detail | `skipped_stale` audit entry |
| Conflict blocked | Conflicts tab | Row appears with CONFLICT badge |
| Conflict resolved | Sync Links | Status returns to SYNCED |
| Error recorded | Sync Links → ERROR filter | `reconcile_failed` audit entry with error message |
