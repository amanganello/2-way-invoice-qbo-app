import { describe, it, expect, vi } from "vitest";
import { pullInvoice, type PullDeps } from "@/application/sync/pull.use-case.js";
import { toCurrencyCode, toMoney, type Invoice, type QBOInvoiceResult } from "@/domain/invoices/invoice.types.js";
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
    syncStatus: "SYNCED", lastSyncedAt: new Date(),
    lastSyncedSnapshot: null, version: 0,
    createdAt: new Date(), updatedAt: new Date(), ...overrides,
  };
}

function makeQBOResult(overrides: Partial<QBOInvoiceResult> = {}): QBOInvoiceResult {
  return {
    qboId: "qbo-1", qboSyncToken: "2",
    qboUpdatedAt: new Date("2026-06-01"), // newer than syncLink.qboUpdatedAt
    invoice: makeInvoice({ status: "paid" }), ...overrides,
  };
}

function makeDeps() {
  return {
    invoiceRepo: { findById: vi.fn(async () => makeInvoice()), save: vi.fn(async (i: Invoice) => i) },
    syncLinkRepo: {
      findByInternalId: vi.fn(async () => makeSyncLink()),
      findByQboId: vi.fn(async () => makeSyncLink()),
      findById: vi.fn(async () => makeSyncLink()),
      list: vi.fn(async () => []),
      listConflicts: vi.fn(async () => []),
      create: vi.fn(async () => makeSyncLink()),
      setProcessing: vi.fn(async () => true),
      setStatus: vi.fn(async () => makeSyncLink()),
      upsertLinked: vi.fn(async () => makeSyncLink()),
      findByStatuses: vi.fn(async () => []),
      findStuckProcessing: vi.fn(async () => []),
      findUnsynced: vi.fn(async () => []),
      findInvoicesWithoutSyncLink: vi.fn(async () => []),
    },
    qboInvoicePort: {
      getInvoice: vi.fn(async () => makeQBOResult()),
      createInvoice: vi.fn(async () => makeQBOResult()),
      updateInvoice: vi.fn(async () => makeQBOResult()),
      voidInvoice: vi.fn(async () => makeQBOResult()),
      findByDocNumber: vi.fn(async () => null),
    },
    auditLogRepo: { create: vi.fn(async () => {}), findBySyncLinkId: vi.fn(async () => []) },
  } satisfies PullDeps;
}

// version in makeSyncLink is 0; after setProcessing increments it, currentVersion = 1
const PROCESSING_VERSION = 1;

describe("pullInvoice", () => {
  it("applies QBO invoice update when not stale", async () => {
    const deps = makeDeps();
    await pullInvoice("qbo-1", "Update", "evt-1", deps);
    expect(deps.invoiceRepo.save).toHaveBeenCalledOnce();
    expect(deps.syncLinkRepo.setStatus).toHaveBeenCalledWith(
      "sl-1", PROCESSING_VERSION, "SYNCED", expect.objectContaining({ qboSyncToken: "2" })
    );
  });

  it("skips stale events (LastUpdatedTime <= qboUpdatedAt)", async () => {
    const deps = makeDeps();
    // qboUpdatedAt in SyncLink is 2026-12-01; QBO result is 2026-06-01 (older)
    (deps.syncLinkRepo.findByQboId as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeSyncLink({ qboUpdatedAt: new Date("2026-12-01") }) // newer than QBO result
    );
    await pullInvoice("qbo-1", "Update", "evt-1", deps);
    expect(deps.invoiceRepo.save).not.toHaveBeenCalled();
    expect(deps.auditLogRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ action: "skipped_stale" })
    );
  });

  it("marks as CONFLICT when dueDate changed on both sides", async () => {
    const snapshot = makeInvoice({ dueDate: new Date("2030-01-01") });
    const deps = makeDeps();
    (deps.syncLinkRepo.findByQboId as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeSyncLink({
        lastSyncedSnapshot: {
          ...snapshot,
          dueDate: snapshot.dueDate.toISOString(),
          status: "sent",
          lineItems: [],
        },
      })
    );
    (deps.invoiceRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeInvoice({ dueDate: new Date("2030-02-01") }) // internal changed dueDate
    );
    (deps.qboInvoicePort.getInvoice as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeQBOResult({ invoice: makeInvoice({ dueDate: new Date("2030-03-01") }) }) // QBO also changed
    );
    await pullInvoice("qbo-1", "Update", "evt-1", deps);
    expect(deps.syncLinkRepo.setStatus).toHaveBeenCalledWith("sl-1", PROCESSING_VERSION, "CONFLICT", expect.anything());
    expect(deps.invoiceRepo.save).not.toHaveBeenCalled();
  });

  it("sets internal invoice status to void on Void event", async () => {
    const deps = makeDeps();
    await pullInvoice("qbo-1", "Void", "evt-1", deps);
    const savedInvoice = (deps.invoiceRepo.save as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(savedInvoice.status).toBe("void");
    expect(deps.qboInvoicePort.getInvoice).not.toHaveBeenCalled();
  });

  it("sets ERROR status when void event arrives and internal invoice is missing", async () => {
    const deps = makeDeps();
    (deps.invoiceRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await pullInvoice("qbo-1", "Void", "evt-1", deps);
    expect(deps.syncLinkRepo.setStatus).toHaveBeenCalledWith(
      "sl-1", PROCESSING_VERSION, "ERROR", expect.anything()
    );
    expect(deps.auditLogRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ action: "void_internal_not_found", result: "FAILURE" })
    );
    expect(deps.invoiceRepo.save).not.toHaveBeenCalled();
  });

  it("sets SYNCED with skipped_already_voided when invoice is already void", async () => {
    const deps = makeDeps();
    (deps.invoiceRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeInvoice({ status: "void" })
    );
    await pullInvoice("qbo-1", "Void", "evt-1", deps);
    expect(deps.syncLinkRepo.setStatus).toHaveBeenCalledWith(
      "sl-1", PROCESSING_VERSION, "SYNCED", expect.anything()
    );
    expect(deps.auditLogRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ action: "skipped_already_voided", result: "SUCCESS" })
    );
    expect(deps.invoiceRepo.save).not.toHaveBeenCalled();
  });

  it("exits silently when optimistic lock fails", async () => {
    const deps = makeDeps();
    (deps.syncLinkRepo.setProcessing as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    await pullInvoice("qbo-1", "Update", "evt-1", deps);
    expect(deps.invoiceRepo.save).not.toHaveBeenCalled();
  });

  it("exits silently when no SyncLink found for qboId", async () => {
    const deps = makeDeps();
    (deps.syncLinkRepo.findByQboId as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await pullInvoice("qbo-1", "Update", "evt-1", deps);
    expect(deps.invoiceRepo.save).not.toHaveBeenCalled();
  });

  it("does not false-conflict when snapshot has numeric amounts (legacy format)", async () => {
    const deps = makeDeps();
    (deps.syncLinkRepo.findByQboId as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeSyncLink({
        lastSyncedSnapshot: {
          customerId: "cust-1",
          lineItems: [],
          totalAmount: 100,       // old numeric format
          currency: "USD",
          status: "sent",
          dueDate: new Date("2030-01-01").toISOString(),
        },
      })
    );
    (deps.invoiceRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeInvoice({ totalAmount: toMoney("100.00") })
    );
    (deps.qboInvoicePort.getInvoice as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeQBOResult({ invoice: makeInvoice({ totalAmount: toMoney("100.00"), status: "paid" }) })
    );
    await pullInvoice("qbo-1", "Update", "evt-1", deps);
    // Should not call setStatus with CONFLICT
    expect(deps.syncLinkRepo.setStatus).not.toHaveBeenCalledWith(
      expect.anything(), expect.anything(), "CONFLICT", expect.anything()
    );
  });
});
