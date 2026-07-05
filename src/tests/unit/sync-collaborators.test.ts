import { describe, expect, it, vi } from "vitest";
import { detectConflicts } from "@/application/sync/conflict-detection";
import { PartialPaymentPolicy } from "@/application/sync/partial-payment-policy";
import { QboInvoiceSyncExecutor } from "@/application/sync/qbo-invoice-sync-executor";
import { QboSyncContextResolver } from "@/application/sync/qbo-sync-context-resolver";
import { QboDuplicateDocumentError, QboStaleObjectError } from "@/application/sync/qbo-sync-errors";
import { SyncLinkStateMachine } from "@/application/sync/sync-link-state-machine";
import { AuditRecorder } from "@/application/sync/audit-recorder";
import type { Invoice, QBOInvoicePort, QBOInvoiceResult } from "@/domain/invoices/invoice.types";
import type { SyncLinkRecord, SyncLinkPort } from "@/application/ports/sync.ports";

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "inv-1",
    customerId: "cust-1",
    lineItems: [],
    totalAmount: "100.00",
    currency: "USD",
    status: "sent",
    dueDate: new Date("2030-01-01"),
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function makeSyncLink(overrides: Partial<SyncLinkRecord> = {}): SyncLinkRecord {
  return {
    id: "sl-1",
    internalId: "inv-1",
    qboId: "qbo-1",
    qboSyncToken: "1",
    qboUpdatedAt: new Date("2026-01-01"),
    internalUpdatedAt: new Date("2026-01-01"),
    syncStatus: "SYNCED",
    lastSyncedAt: new Date("2026-01-01"),
    lastSyncedSnapshot: null,
    version: 0,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function makeQboResult(overrides: Partial<QBOInvoiceResult> = {}): QBOInvoiceResult {
  return {
    qboId: "qbo-1",
    qboSyncToken: "2",
    qboUpdatedAt: new Date("2026-06-01"),
    invoice: makeInvoice(),
    ...overrides,
  };
}

describe("QboSyncContextResolver", () => {
  it("resolves mapped customer, item, account, and deterministic doc number", async () => {
    const resolver = new QboSyncContextResolver({
      customerMapRepo: {
        findByInternalId: vi.fn(async () => ({ qboCustomerId: "qbo-cust-1" })),
        upsertMany: vi.fn(async () => 0),
        findAll: vi.fn(async () => []),
      },
      itemMapRepo: {
        findByInternalCode: vi.fn(async () => ({ qboItemId: "qbo-item-1", defaultTaxCode: "TAX" })),
        upsertMany: vi.fn(async () => 0),
        findAll: vi.fn(async () => []),
      },
      accountMapRepo: {
        findByInternalCode: vi.fn(async () => ({ qboAccountId: "qbo-account-1" })),
        upsertMany: vi.fn(async () => 0),
        findAll: vi.fn(async () => []),
      },
      qbEnvironment: "production",
      qbDefaultItemId: "default-item",
    });

    const ctx = await resolver.resolve(makeInvoice({
      id: "invoice-12345678901234567890",
      lineItems: [{
        description: "Service",
        quantity: 1,
        unitPrice: "10.00",
        amount: "10.00",
        internalItemCode: "svc",
        internalAccountCode: "sales",
      }],
    }));

    expect(ctx.customerRef).toBe("qbo-cust-1");
    expect(ctx.itemMap.get("svc")).toEqual({ qboItemId: "qbo-item-1", taxCode: "TAX" });
    expect(ctx.accountMap.get("sales")).toEqual({ qboAccountId: "qbo-account-1" });
    expect(ctx.docNumber).toBe("invoice1234567890123");
  });

  it("uses sandbox default customer when no mapping exists", async () => {
    const resolver = new QboSyncContextResolver({
      customerMapRepo: { findByInternalId: vi.fn(async () => null), upsertMany: vi.fn(async () => 0), findAll: vi.fn(async () => []) },
      itemMapRepo: { findByInternalCode: vi.fn(async () => null), upsertMany: vi.fn(async () => 0), findAll: vi.fn(async () => []) },
      accountMapRepo: { findByInternalCode: vi.fn(async () => null), upsertMany: vi.fn(async () => 0), findAll: vi.fn(async () => []) },
      qbEnvironment: "sandbox",
      qbDefaultCustomerId: "default-cust",
    });

    await expect(resolver.resolve(makeInvoice())).resolves.toMatchObject({ customerRef: "default-cust" });
  });
});

describe("PartialPaymentPolicy", () => {
  it("blocks line item changes on invoices with linked payments", async () => {
    const policy = new PartialPaymentPolicy({
      findByInternalId: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: "psl-1", internalId: "pay-1", qboId: "qbo-pay-1", invoiceInternalId: "inv-1", syncStatus: "SYNCED", lastSyncedAt: null, createdAt: new Date(), updatedAt: new Date() })),
      findByInvoiceInternalId: vi.fn(async () => [{ id: "psl-1", internalId: "pay-1", qboId: "qbo-pay-1", invoiceInternalId: "inv-1", syncStatus: "SYNCED", lastSyncedAt: null, createdAt: new Date(), updatedAt: new Date() }]),
    });

    await expect(policy.assertEditable(
      makeInvoice({ lineItems: [{ description: "Changed", quantity: 1, unitPrice: "100.00", amount: "100.00" }] }),
      {
        customerId: "cust-1",
        lineItems: [{ description: "Original", quantity: 1, unitPrice: 100, amount: 100 }],
        totalAmount: 100,
        currency: "USD",
        status: "sent",
        dueDate: new Date("2030-01-01").toISOString(),
      }
    )).rejects.toThrow(/lineItems and totalAmount/);
  });

  it("allows date-only changes on invoices with linked payments", async () => {
    const policy = new PartialPaymentPolicy({
      findByInternalId: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: "psl-1", internalId: "pay-1", qboId: "qbo-pay-1", invoiceInternalId: "inv-1", syncStatus: "SYNCED", lastSyncedAt: null, createdAt: new Date(), updatedAt: new Date() })),
      findByInvoiceInternalId: vi.fn(async () => [{ id: "psl-1", internalId: "pay-1", qboId: "qbo-pay-1", invoiceInternalId: "inv-1", syncStatus: "SYNCED", lastSyncedAt: null, createdAt: new Date(), updatedAt: new Date() }]),
    });

    await expect(policy.assertEditable(
      makeInvoice({ dueDate: new Date("2030-02-01") }),
      {
        customerId: "cust-1",
        lineItems: [],
        totalAmount: 100,
        currency: "USD",
        status: "sent",
        dueDate: new Date("2030-01-01").toISOString(),
      }
    )).resolves.not.toThrow();
  });
});

describe("QboInvoiceSyncExecutor", () => {
  function makeExecutor(overrides: Partial<QBOInvoicePort> = {}) {
    const syncLinkRepo = {
      findByInternalId: vi.fn(async () => makeSyncLink()),
      findByQboId: vi.fn(async () => null),
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
    } satisfies SyncLinkPort;
    const qboPort = {
      createInvoice: vi.fn(async () => makeQboResult()),
      updateInvoice: vi.fn(async () => makeQboResult()),
      voidInvoice: vi.fn(async () => makeQboResult()),
      getInvoice: vi.fn(async () => makeQboResult({ qboSyncToken: "fresh" })),
      findByDocNumber: vi.fn(async () => null),
      ...overrides,
    } satisfies QBOInvoicePort;
    const auditLogRepo = { create: vi.fn(async () => {}), findBySyncLinkId: vi.fn(async () => []) };
    const executor = new QboInvoiceSyncExecutor(qboPort, new SyncLinkStateMachine(syncLinkRepo), new AuditRecorder(auditLogRepo));
    return { executor, qboPort, syncLinkRepo, auditLogRepo };
  }

  it("links an existing QBO invoice on duplicate create", async () => {
    const existing = makeQboResult({ qboId: "existing" });
    const { executor, qboPort, syncLinkRepo } = makeExecutor({
      createInvoice: vi.fn(async () => { throw new QboDuplicateDocumentError(); }),
      findByDocNumber: vi.fn(async () => existing),
    });

    await executor.execute({ type: "create", version: 0 }, makeInvoice(), {
      customerRef: "qbo-cust",
      itemMap: new Map(),
      accountMap: new Map(),
      docNumber: "inv1",
    }, "evt-1");

    expect(qboPort.findByDocNumber).toHaveBeenCalledWith("inv1");
    expect(syncLinkRepo.upsertLinked).toHaveBeenCalledWith("inv-1", "existing", "2", expect.any(Date), expect.any(Object), 0);
  });

  it("marks pending with fresh token on stale update", async () => {
    const { executor, syncLinkRepo } = makeExecutor({
      updateInvoice: vi.fn(async () => { throw new QboStaleObjectError(); }),
    });

    await expect(executor.execute({ type: "update", syncLink: makeSyncLink() }, makeInvoice(), {
      customerRef: "qbo-cust",
      itemMap: new Map(),
      accountMap: new Map(),
      docNumber: "inv1",
    }, "evt-1")).resolves.toEqual({ outcome: "pending-after-stale-token" });

    expect(syncLinkRepo.setStatus).toHaveBeenCalledWith(
      "sl-1",
      0,
      "PENDING",
      expect.objectContaining({ qboSyncToken: "fresh" })
    );
  });
});

describe("SyncLinkStateMachine", () => {
  it("returns acquired false when optimistic lock is not obtained", async () => {
    const state = new SyncLinkStateMachine({
      findByInternalId: vi.fn(async () => makeSyncLink()),
      findByQboId: vi.fn(async () => null),
      findById: vi.fn(async () => null),
      list: vi.fn(async () => []),
      listConflicts: vi.fn(async () => []),
      create: vi.fn(async () => makeSyncLink()),
      setProcessing: vi.fn(async () => false),
      setStatus: vi.fn(async () => makeSyncLink()),
      upsertLinked: vi.fn(async () => makeSyncLink()),
      findByStatuses: vi.fn(async () => []),
      findStuckProcessing: vi.fn(async () => []),
      findUnsynced: vi.fn(async () => []),
      findInvoicesWithoutSyncLink: vi.fn(async () => []),
    });

    await expect(state.acquireProcessing("inv-1")).resolves.toEqual({ acquired: false });
  });
});

describe("conflict comparators", () => {
  it("does not conflict on equivalent money and date representations", () => {
    const snapshot = makeInvoice({ totalAmount: "100.00", dueDate: new Date("2030-01-01T00:00:00.000Z") });
    const internal = makeInvoice({ totalAmount: "100.00", dueDate: new Date("2030-01-01T12:00:00.000Z") });
    const qbo = makeInvoice({ totalAmount: "100.00", dueDate: new Date("2030-01-01T06:00:00.000Z") });

    expect(detectConflicts(snapshot, internal, qbo).hasConflict).toBe(false);
  });
});
