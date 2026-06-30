import { describe, it, expect, vi } from "vitest";
import { reconcileInvoice } from "@/application/sync/reconcile.use-case.js";
import type { Invoice, QBOInvoicePort, QBOInvoiceResult, QBOSyncContext } from "@/domain/invoices/invoice.types.js";
import type { SyncLinkRecord } from "@/infrastructure/database/sync-link.repository.js";

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "inv-1", customerId: "cust-1", lineItems: [],
    totalAmount: 100, currency: "USD", status: "sent",
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

function makeDeps(overrides: Partial<Parameters<typeof reconcileInvoice>[1]> = {}) {
  return {
    invoiceRepo: { findById: vi.fn(async () => makeInvoice()), save: vi.fn(async (i: Invoice) => i) },
    syncLinkRepo: {
      findByInternalId: vi.fn(async () => makeSyncLink()),
      setProcessing: vi.fn(async () => true),
      setStatus: vi.fn(async () => makeSyncLink()),
      upsertLinked: vi.fn(async () => makeSyncLink()),
    },
    paymentSyncLinkRepo: { findByInvoiceInternalId: vi.fn(async () => []) },
    accountMapRepo: { findByInternalCode: vi.fn(async () => null) },
    itemMapRepo: { findByInternalCode: vi.fn(async () => null) },
    customerMapRepo: { findByInternalId: vi.fn(async () => ({ internalCustomerId: "cust-1", qboCustomerId: "QBO-CUST-1", qboCustomerName: "Test" })) },
    qboInvoicePort: {
      createInvoice: vi.fn(async () => makeQBOResult()),
      updateInvoice: vi.fn(async () => makeQBOResult()),
      voidInvoice: vi.fn(async () => makeQBOResult()),
      getInvoice: vi.fn(async () => makeQBOResult()),
      findByDocNumber: vi.fn(async () => null),
    } as QBOInvoicePort,
    auditLogRepo: { create: vi.fn(async () => {}) },
    qbDefaultCustomerId: undefined,
    qbEnvironment: "sandbox",
    ...overrides,
  };
}

describe("reconcileInvoice", () => {
  it("calls createInvoice when no SyncLink exists", async () => {
    const deps = makeDeps({
      syncLinkRepo: { ...makeDeps().syncLinkRepo, findByInternalId: vi.fn(async () => null) },
    });
    await reconcileInvoice("inv-1", deps as never);
    expect(deps.qboInvoicePort.createInvoice).toHaveBeenCalledOnce();
    expect(deps.syncLinkRepo.upsertLinked).toHaveBeenCalledOnce();
  });

  it("calls updateInvoice when SyncLink with qboId exists", async () => {
    const deps = makeDeps();
    await reconcileInvoice("inv-1", deps as never);
    expect(deps.qboInvoicePort.updateInvoice).toHaveBeenCalledOnce();
  });

  it("calls voidInvoice when invoice status is void and SyncLink exists", async () => {
    const deps = makeDeps({
      invoiceRepo: { ...makeDeps().invoiceRepo, findById: vi.fn(async () => makeInvoice({ status: "void" })) },
    });
    await reconcileInvoice("inv-1", deps as never);
    expect(deps.qboInvoicePort.voidInvoice).toHaveBeenCalledOnce();
  });

  it("no-ops when invoice is void and no SyncLink exists, writes AuditLog", async () => {
    const deps = makeDeps({
      invoiceRepo: { ...makeDeps().invoiceRepo, findById: vi.fn(async () => makeInvoice({ status: "void" })) },
      syncLinkRepo: { ...makeDeps().syncLinkRepo, findByInternalId: vi.fn(async () => null) },
    });
    await reconcileInvoice("inv-1", deps as never);
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
    await reconcileInvoice("inv-1", deps as never);
    expect(deps.qboInvoicePort.updateInvoice).not.toHaveBeenCalled();
  });

  it("throws ExternalServiceError when customer not in CustomerMap and no fallback", async () => {
    const deps = makeDeps({
      syncLinkRepo: { ...makeDeps().syncLinkRepo, findByInternalId: vi.fn(async () => null) },
      customerMapRepo: { findByInternalId: vi.fn(async () => null) },
      qbDefaultCustomerId: undefined,
      qbEnvironment: "production",
    });
    await expect(reconcileInvoice("inv-1", deps as never)).rejects.toThrow("No CustomerMap entry");
  });

  it("uses QB_DEFAULT_CUSTOMER_ID fallback in sandbox when no CustomerMap entry", async () => {
    const deps = makeDeps({
      syncLinkRepo: { ...makeDeps().syncLinkRepo, findByInternalId: vi.fn(async () => null) },
      customerMapRepo: { findByInternalId: vi.fn(async () => null) },
      qbDefaultCustomerId: "DEFAULT-CUST",
      qbEnvironment: "sandbox",
    });
    await reconcileInvoice("inv-1", deps as never);
    const callArg = (deps.qboInvoicePort.createInvoice as ReturnType<typeof vi.fn>).mock.calls[0][1] as QBOSyncContext;
    expect(callArg.customerRef).toBe("DEFAULT-CUST");
  });

  it("blocks update when lineItems changed on a partially-paid invoice", async () => {
    const snapshot = {
      lineItems: [{ description: "Original", quantity: 1, unitPrice: 100, amount: 100 }],
      totalAmount: 100,
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
            lineItems: [{ description: "Changed", quantity: 2, unitPrice: 50, amount: 100 }],
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
        findByInvoiceInternalId: vi.fn(async () => [{ id: "psl-1" }]),
      },
    });
    await expect(reconcileInvoice("inv-1", deps as never)).rejects.toThrow(
      /lineItems and totalAmount cannot be modified/
    );
  });

  it("allows update when only dueDate changed on a partially-paid invoice", async () => {
    const snapshot = {
      lineItems: [],
      totalAmount: 100,
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
        findByInvoiceInternalId: vi.fn(async () => [{ id: "psl-1" }]),
      },
    });
    // dueDate change is allowed on partially-paid invoices
    await expect(reconcileInvoice("inv-1", deps as never)).resolves.not.toThrow();
    expect(deps.qboInvoicePort.updateInvoice).toHaveBeenCalledOnce();
  });
});
