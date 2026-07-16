import { describe, it, expect, vi } from "vitest";
import { reconcileInvoice, type ReconcileDeps } from "@/application/sync/reconcile.use-case.js";
import { QboDuplicateDocumentError } from "@/application/sync/qbo-sync-errors.js";
import { toMoney, toCurrencyCode, type Invoice } from "@/domain/invoices/invoice.types.js";
import type { QBOInvoicePort, QBOInvoiceResult, QBOSyncContext } from "@/application/ports/qbo.ports.js";
import type { PaymentSyncLinkRecord, SyncLinkRecord } from "@/application/ports/sync.ports.js";

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "inv-1", customerId: "cust-1", lineItems: [],
    totalAmount: toMoney("100.00"), currency: toCurrencyCode("USD"), status: "sent",
    dueDate: new Date("2030-01-01"), createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  };
}

function makeQBOResult(overrides: Partial<QBOInvoiceResult> = {}): QBOInvoiceResult {
  return {
    qboId: "qbo-1", qboSyncToken: "1", qboUpdatedAt: new Date(),
    invoice: makeInvoice(), ...overrides,
  };
}

function makeSyncLink(overrides: Partial<SyncLinkRecord> = {}): SyncLinkRecord {
  return {
    id: "sl-1", internalId: "inv-1", qboId: "qbo-1", qboSyncToken: "1",
    qboUpdatedAt: new Date(), internalUpdatedAt: new Date(), syncStatus: "SYNCED",
    lastSyncedAt: new Date(), lastSyncedSnapshot: null, version: 0,
    createdAt: new Date(), updatedAt: new Date(), ...overrides,
  };
}

function makePaymentSyncLink(overrides: Partial<PaymentSyncLinkRecord> = {}): PaymentSyncLinkRecord {
  return {
    id: "psl-1",
    internalId: "pay-1",
    qboId: "qbo-pay-1",
    invoiceInternalId: "inv-1",
    syncStatus: "SYNCED",
    lastSyncedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeDeps(overrides: Partial<Parameters<typeof reconcileInvoice>[1]> = {}) {
  const deps = {
    invoiceRepo: { findById: vi.fn(async () => makeInvoice()), save: vi.fn(async (i: Invoice) => i) },
    syncLinkRepo: {
      findByInternalId: vi.fn(async () => makeSyncLink()),
      findByQboId: vi.fn(async () => null),
      findById: vi.fn(async () => makeSyncLink()),
      list: vi.fn(async () => [makeSyncLink()]),
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
    paymentSyncLinkRepo: {
      findByInternalId: vi.fn(async () => null),
      findByInvoiceInternalId: vi.fn(async () => []),
      create: vi.fn(async () => makePaymentSyncLink()),
    },
    accountMapRepo: { findByInternalCode: vi.fn(async () => null), upsertMany: vi.fn(async () => 0), findAll: vi.fn(async () => []) },
    itemMapRepo: { findByInternalCode: vi.fn(async () => null), upsertMany: vi.fn(async () => 0), findAll: vi.fn(async () => []) },
    customerMapRepo: {
      findByInternalId: vi.fn(async () => ({ qboCustomerId: "QBO-CUST-1" })),
      upsertMany: vi.fn(async () => 0),
      findAll: vi.fn(async () => []),
    },
    qboInvoicePort: {
      createInvoice: vi.fn(async () => makeQBOResult()),
      updateInvoice: vi.fn(async () => makeQBOResult()),
      voidInvoice: vi.fn(async () => makeQBOResult()),
      getInvoice: vi.fn(async () => makeQBOResult()),
      findByDocNumber: vi.fn(async () => null),
      listInvoices: vi.fn(async () => []),
    } as QBOInvoicePort,
    auditLogRepo: { create: vi.fn(async () => {}), findBySyncLinkId: vi.fn(async () => []) },
    qbDefaultCustomerId: undefined,
    qbEnvironment: "sandbox",
    ...overrides,
  } satisfies ReconcileDeps;
  return deps;
}

function makeNewInvoiceSyncLinkRepo() {
  const created = makeSyncLink({
    qboId: null,
    qboSyncToken: null,
    qboUpdatedAt: null,
    syncStatus: "PENDING",
    lastSyncedAt: null,
    version: 0,
  });
  const locked = makeSyncLink({
    ...created,
    syncStatus: "PROCESSING",
    version: 1,
  });
  return {
    ...makeDeps().syncLinkRepo,
    findByInternalId: vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValue(locked),
    create: vi.fn(async () => created),
  };
}

describe("reconcileInvoice", () => {
  it("calls createInvoice when no SyncLink exists", async () => {
    const deps = makeDeps({
      syncLinkRepo: makeNewInvoiceSyncLinkRepo(),
    });
    await reconcileInvoice("inv-1", deps);
    expect(deps.qboInvoicePort.createInvoice).toHaveBeenCalledOnce();
    expect(deps.syncLinkRepo.upsertLinked).toHaveBeenCalledOnce();
  });

  it("calls updateInvoice when SyncLink with qboId exists", async () => {
    const deps = makeDeps();
    await reconcileInvoice("inv-1", deps);
    expect(deps.qboInvoicePort.updateInvoice).toHaveBeenCalledOnce();
  });

  it("calls voidInvoice when invoice status is void and SyncLink exists", async () => {
    const deps = makeDeps({
      invoiceRepo: { ...makeDeps().invoiceRepo, findById: vi.fn(async () => makeInvoice({ status: "void" })) },
    });
    await reconcileInvoice("inv-1", deps);
    expect(deps.qboInvoicePort.voidInvoice).toHaveBeenCalledOnce();
  });

  it("no-ops when invoice is void and no SyncLink exists, writes AuditLog", async () => {
    const deps = makeDeps({
      invoiceRepo: { ...makeDeps().invoiceRepo, findById: vi.fn(async () => makeInvoice({ status: "void" })) },
      syncLinkRepo: makeNewInvoiceSyncLinkRepo(),
    });
    await reconcileInvoice("inv-1", deps);
    expect(deps.qboInvoicePort.voidInvoice).not.toHaveBeenCalled();
    expect(deps.qboInvoicePort.createInvoice).not.toHaveBeenCalled();
    expect(deps.auditLogRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ action: "skipped_no_sync_link_for_void", result: "SUCCESS" })
    );
  });

  it("exits silently when optimistic lock fails", async () => {
    const deps = makeDeps({
      syncLinkRepo: { ...makeDeps().syncLinkRepo, setProcessing: vi.fn(async () => false) },
    });
    await reconcileInvoice("inv-1", deps);
    expect(deps.qboInvoicePort.updateInvoice).not.toHaveBeenCalled();
  });

  it("throws ExternalServiceError when customer not in CustomerMap and no fallback", async () => {
    const deps = makeDeps({
      syncLinkRepo: makeNewInvoiceSyncLinkRepo(),
      customerMapRepo: { ...makeDeps().customerMapRepo, findByInternalId: vi.fn(async () => null) },
      qbDefaultCustomerId: undefined,
      qbEnvironment: "production",
    });
    await expect(reconcileInvoice("inv-1", deps)).rejects.toThrow("No CustomerMap entry");
  });

  it("uses QB_DEFAULT_CUSTOMER_ID fallback in sandbox when no CustomerMap entry", async () => {
    const deps = makeDeps({
      syncLinkRepo: makeNewInvoiceSyncLinkRepo(),
      customerMapRepo: { ...makeDeps().customerMapRepo, findByInternalId: vi.fn(async () => null) },
      qbDefaultCustomerId: "DEFAULT-CUST",
      qbEnvironment: "sandbox",
    });
    await reconcileInvoice("inv-1", deps);
    const callArg = (deps.qboInvoicePort.createInvoice as ReturnType<typeof vi.fn>).mock.calls[0][1] as QBOSyncContext;
    expect(callArg.customerRef).toBe("DEFAULT-CUST");
  });

  it("blocks update when lineItems changed on a partially-paid invoice", async () => {
    const snapshot = {
      lineItems: [{ description: "Original", quantity: 1, unitPrice: "100.00", amount: "100.00" }],
      totalAmount: "100.00",
      currency: "USD",
      status: "sent",
      customerId: "cust-1",
      dueDate: new Date("2030-01-01").toISOString(),
    };
    const deps = makeDeps({
      invoiceRepo: {
        ...makeDeps().invoiceRepo,
        findById: vi.fn(async () =>
          makeInvoice({
            lineItems: [{ description: "Changed", quantity: 2, unitPrice: toMoney("50.00"), amount: toMoney("100.00") }],
          })
        ),
      },
      syncLinkRepo: {
        ...makeDeps().syncLinkRepo,
        findByInternalId: vi.fn(async () =>
          makeSyncLink({ lastSyncedSnapshot: snapshot })
        ),
      },
      paymentSyncLinkRepo: {
        ...makeDeps().paymentSyncLinkRepo,
        findByInvoiceInternalId: vi.fn(async () => [makePaymentSyncLink()]),
      },
    });
    await expect(reconcileInvoice("inv-1", deps)).rejects.toThrow(
      /lineItems and totalAmount cannot be modified/
    );
  });

  it("sets syncStatus ERROR and writes AuditLog when QBO call fails", async () => {
    const deps = makeDeps({
      qboInvoicePort: {
        ...makeDeps().qboInvoicePort,
        updateInvoice: vi.fn(async () => { throw new Error("QBO timeout"); }),
      } as QBOInvoicePort,
    });
    await expect(reconcileInvoice("inv-1", deps)).rejects.toThrow("QBO timeout");
    expect(deps.syncLinkRepo.setStatus).toHaveBeenCalledWith("sl-1", 0, "ERROR", {});
    expect(deps.auditLogRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ action: "reconcile_failed", result: "FAILURE" })
    );
  });

  it("links existing QBO invoice on duplicate create error (timeout-after-write recovery)", async () => {
    const existingResult = makeQBOResult({ qboId: "qbo-existing", qboSyncToken: "2" });
    const deps = makeDeps({
      syncLinkRepo: makeNewInvoiceSyncLinkRepo(),
      qboInvoicePort: {
        ...makeDeps().qboInvoicePort,
        createInvoice: vi.fn(async () => { throw new QboDuplicateDocumentError("Duplicate Document Number Error, 6240"); }),
        findByDocNumber: vi.fn(async () => existingResult),
      } as QBOInvoicePort,
    });
    await reconcileInvoice("inv-1", deps);
    // docNumber = internalId stripped of dashes, truncated to 20 chars → "inv1"
    expect(deps.qboInvoicePort.findByDocNumber).toHaveBeenCalledWith("inv1");
    expect(deps.syncLinkRepo.upsertLinked).toHaveBeenCalledWith(
      "inv-1", "qbo-existing", "2", expect.any(Date), expect.any(Object), 1
    );
    expect(deps.auditLogRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ action: "invoice_created_in_qbo", result: "SUCCESS" })
    );
  });

  it("partially-paid guard: does not throw when totalAmount unchanged (numeric snapshot)", async () => {
    const deps = makeDeps({
      syncLinkRepo: {
        ...makeDeps().syncLinkRepo,
        findByInternalId: vi.fn(async () => makeSyncLink({
          qboId: "qbo-1",
          lastSyncedSnapshot: {
            // old numeric format — pre-migration snapshot
            totalAmount: 100,
            lineItems: [{ description: "Service", quantity: 1, unitPrice: 100, amount: 100 }],
            currency: "USD",
            status: "sent",
            customerId: "cust-1",
            dueDate: new Date("2030-01-01").toISOString(),
          },
        })),
      },
      paymentSyncLinkRepo: {
        ...makeDeps().paymentSyncLinkRepo,
        findByInvoiceInternalId: vi.fn(async () => [makePaymentSyncLink()]),  // has payments
      },
      invoiceRepo: {
        findById: vi.fn(async () => makeInvoice({
          totalAmount: toMoney("100.00"),
          lineItems: [{ description: "Service", quantity: 1, unitPrice: toMoney("100.00"), amount: toMoney("100.00") }],
        })),
        save: vi.fn(async (i: Invoice) => i),
      },
    });
    // Should NOT throw — amounts are equal, just different formats
    await expect(reconcileInvoice("inv-1", deps)).resolves.not.toThrow();
  });

  it("allows update when only dueDate changed on a partially-paid invoice", async () => {
    const snapshot = {
      lineItems: [],
      totalAmount: "100.00",
      currency: "USD",
      status: "sent",
      customerId: "cust-1",
      dueDate: new Date("2030-01-01").toISOString(),
    };
    const deps = makeDeps({
      invoiceRepo: {
        ...makeDeps().invoiceRepo,
        findById: vi.fn(async () =>
          makeInvoice({ dueDate: new Date("2030-06-01") })
        ),
      },
      syncLinkRepo: {
        ...makeDeps().syncLinkRepo,
        findByInternalId: vi.fn(async () =>
          makeSyncLink({ lastSyncedSnapshot: snapshot })
        ),
      },
      paymentSyncLinkRepo: {
        ...makeDeps().paymentSyncLinkRepo,
        findByInvoiceInternalId: vi.fn(async () => [makePaymentSyncLink()]),
      },
    });
    // dueDate change is allowed on partially-paid invoices
    await expect(reconcileInvoice("inv-1", deps)).resolves.not.toThrow();
    expect(deps.qboInvoicePort.updateInvoice).toHaveBeenCalledOnce();
  });
});
