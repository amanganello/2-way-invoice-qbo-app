import { describe, it, expect, vi } from "vitest";
import { resolveConflict } from "@/application/sync/sync-management.use-cases.js";
import { toCurrencyCode, toMoney, type Invoice } from "@/domain/invoices/invoice.types.js";
import type { QBOInvoiceResult } from "@/application/ports/qbo.ports.js";
import type { SyncLinkRecord } from "@/application/ports/sync.ports.js";

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "inv-1", customerId: "cust-1", lineItems: [],
    totalAmount: toMoney("100.00"), currency: toCurrencyCode("USD"), status: "sent",
    dueDate: new Date("2030-01-01"), createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function makeSyncLink(overrides: Partial<SyncLinkRecord> = {}): SyncLinkRecord {
  return {
    id: "sl-1", internalId: "inv-1", qboId: "qbo-1", qboSyncToken: "1",
    qboUpdatedAt: new Date("2026-01-01"), internalUpdatedAt: new Date(),
    syncStatus: "CONFLICT", lastSyncedAt: new Date(),
    lastSyncedSnapshot: null, version: 5,
    createdAt: new Date(), updatedAt: new Date(), ...overrides,
  };
}

function makeQBOResult(overrides: Partial<QBOInvoiceResult> = {}): QBOInvoiceResult {
  return {
    qboId: "qbo-1", qboSyncToken: "10",
    qboUpdatedAt: new Date("2026-06-01"),
    invoice: makeInvoice({ status: "paid", totalAmount: toMoney("200.00") }),
    ...overrides,
  };
}

function makeDeps() {
  return {
    syncLinkRepo: {
      findById: vi.fn(async () => makeSyncLink()),
      setStatus: vi.fn(async () => makeSyncLink()),
      // unused but required by SyncLinkPort:
      findByInternalId: vi.fn(async () => null),
      findByQboId: vi.fn(async () => null),
      list: vi.fn(async () => []),
      listConflicts: vi.fn(async () => []),
      create: vi.fn(async () => makeSyncLink()),
      setProcessing: vi.fn(async () => true),
      upsertLinked: vi.fn(async () => makeSyncLink()),
      findByStatuses: vi.fn(async () => []),
      findStuckProcessing: vi.fn(async () => []),
      findUnsynced: vi.fn(async () => []),
      findInvoicesWithoutSyncLink: vi.fn(async () => []),
    },
    queue: { enqueueReconcile: vi.fn(async () => {}) },
    invoiceRepo: {
      findById: vi.fn(async () => makeInvoice()),
      save: vi.fn(async (i: Invoice) => i),
      findAll: vi.fn(async () => []),
    },
    qboInvoicePort: {
      getInvoice: vi.fn(async () => makeQBOResult()),
      createInvoice: vi.fn(async () => makeQBOResult()),
      updateInvoice: vi.fn(async () => makeQBOResult()),
      voidInvoice: vi.fn(async () => makeQBOResult()),
      findByDocNumber: vi.fn(async () => null),
      listInvoices: vi.fn(async () => []),
    },
  };
}

describe("resolveConflict", () => {
  it("accept-internal: marks PENDING and enqueues reconcile", async () => {
    const deps = makeDeps();
    await resolveConflict(deps, "sl-1", "accept-internal");
    expect(deps.syncLinkRepo.setStatus).toHaveBeenCalledWith("sl-1", 5, "PENDING", {});
    expect(deps.queue.enqueueReconcile).toHaveBeenCalledWith("inv-1");
    expect(deps.invoiceRepo.save).not.toHaveBeenCalled();
    expect(deps.qboInvoicePort.getInvoice).not.toHaveBeenCalled();
  });

  it("accept-qbo: fetches QBO state, overwrites internal invoice, marks SYNCED with QBO token", async () => {
    const deps = makeDeps();
    const qboInvoice = makeInvoice({ status: "paid", totalAmount: toMoney("200.00") });
    (deps.qboInvoicePort.getInvoice as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeQBOResult({ invoice: qboInvoice })
    );
    const originalInternal = makeInvoice({ createdAt: new Date("2025-05-01") });
    (deps.invoiceRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(originalInternal);

    await resolveConflict(deps, "sl-1", "accept-qbo");

    // Must fetch QBO current state
    expect(deps.qboInvoicePort.getInvoice).toHaveBeenCalledWith("qbo-1");
    // Must overwrite internal with QBO data, preserving id and createdAt
    expect(deps.invoiceRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "inv-1",
        createdAt: originalInternal.createdAt,
        status: "paid",
        totalAmount: toMoney("200.00"),
      })
    );
    // Must mark SYNCED with QBO's fresh token and snapshot
    expect(deps.syncLinkRepo.setStatus).toHaveBeenCalledWith(
      "sl-1", 5, "SYNCED",
      expect.objectContaining({
        qboSyncToken: "10",
        qboUpdatedAt: expect.any(Date),
        lastSyncedSnapshot: expect.any(Object),
        lastSyncedAt: expect.any(Date),
      })
    );
    // Must NOT enqueue reconcile (QBO state is now authoritative)
    expect(deps.queue.enqueueReconcile).not.toHaveBeenCalled();
  });

  it("throws NotFoundError when SyncLink is not in CONFLICT state", async () => {
    const deps = makeDeps();
    (deps.syncLinkRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeSyncLink({ syncStatus: "SYNCED" })
    );
    await expect(resolveConflict(deps, "sl-1", "accept-qbo")).rejects.toThrow();
  });
});
