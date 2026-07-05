import { describe, it, expect, vi } from "vitest";
import { syncPayment, type PaymentSyncDeps } from "@/application/sync/payment-sync.use-case";
import { QboDuplicateDocumentError } from "@/application/sync/qbo-sync-errors";
import type { Invoice, Payment } from "@/domain/invoices/invoice.types";

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return { id: "pay-1", invoiceId: "inv-1", amount: "100.00", currency: "USD", paidAt: new Date(), ...overrides };
}

function makeDeps() {
  const invoice: Invoice = {
    id: "inv-1",
    customerId: "cust-1",
    lineItems: [],
    totalAmount: "100.00",
    currency: "USD",
    status: "sent",
    dueDate: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  return {
    paymentRepo: {
      findById: vi.fn(async () => makePayment()),
      save: vi.fn(async (payment: Payment) => payment),
      findByInvoiceId: vi.fn(async () => []),
    },
    // invoiceRepo required: syncPayment looks up the invoice to get customerId,
    // then passes customerId (not invoiceId) to customerMapRepo.findByInternalId.
    invoiceRepo: {
      findById: vi.fn(async () => invoice),
      save: vi.fn(async (i: Invoice) => i),
    },
    paymentSyncLinkRepo: {
      findByInternalId: vi.fn(async () => null),
      findByInvoiceInternalId: vi.fn(async () => []),
      create: vi.fn(async (data) => ({
        id: "psl-1",
        qboId: data.qboId,
        internalId: data.internalId,
        invoiceInternalId: data.invoiceInternalId,
        syncStatus: data.syncStatus ?? "SYNCED",
        lastSyncedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    },
    syncLinkRepo: {
      findByInternalId: vi.fn(async () => ({
        id: "sl-1",
        internalId: "inv-1",
        qboId: "qbo-inv-1",
        qboSyncToken: null,
        qboUpdatedAt: null,
        internalUpdatedAt: new Date(),
        syncStatus: "SYNCED" as const,
        lastSyncedAt: null,
        lastSyncedSnapshot: null,
        version: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
      findByQboId: vi.fn(async () => null),
      findById: vi.fn(async () => null),
      list: vi.fn(async () => []),
      listConflicts: vi.fn(async () => []),
      create: vi.fn(async () => {
        throw new Error("not used");
      }),
      setProcessing: vi.fn(async () => true),
      setStatus: vi.fn(async () => {
        throw new Error("not used");
      }),
      upsertLinked: vi.fn(async () => {
        throw new Error("not used");
      }),
      findByStatuses: vi.fn(async () => []),
      findStuckProcessing: vi.fn(async () => []),
      findUnsynced: vi.fn(async () => []),
      findInvoicesWithoutSyncLink: vi.fn(async () => []),
    },
    customerMapRepo: {
      // Must receive customerId ("cust-1"), NOT invoiceId ("inv-1")
      findByInternalId: vi.fn(async (id: string) => {
        if (id === "cust-1") return { qboCustomerId: "QBO-CUST" };
        return null;
      }),
      upsertMany: vi.fn(async () => 0),
      findAll: vi.fn(async () => []),
    },
    qboPaymentPort: {
      createPayment: vi.fn(async () => ({ qboId: "qbo-pay-1", qboSyncToken: "0" })),
      findByPaymentRefNum: vi.fn(async () => []),
    },
    auditLogRepo: { create: vi.fn(async () => {}), findBySyncLinkId: vi.fn(async () => []) },
    qbDefaultCustomerId: undefined,
    qbEnvironment: "sandbox",
  } satisfies PaymentSyncDeps;
}

describe("syncPayment", () => {
  it("creates payment in QBO and creates PaymentSyncLink", async () => {
    const deps = makeDeps();
    await syncPayment("pay-1", deps);
    expect(deps.qboPaymentPort.createPayment).toHaveBeenCalledOnce();
    expect(deps.paymentSyncLinkRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ internalId: "pay-1", qboId: "qbo-pay-1", invoiceInternalId: "inv-1" })
    );
  });

  it("skips when PaymentSyncLink already exists (idempotent)", async () => {
    const deps = makeDeps();
    (deps.paymentSyncLinkRepo.findByInternalId as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "existing" });
    await syncPayment("pay-1", deps);
    expect(deps.qboPaymentPort.createPayment).not.toHaveBeenCalled();
  });

  it("finds existing payment by PaymentRefNum on duplicate error and links it", async () => {
    const deps = makeDeps();
    (deps.qboPaymentPort.createPayment as ReturnType<typeof vi.fn>).mockRejectedValue(new QboDuplicateDocumentError("Duplicate"));
    (deps.qboPaymentPort.findByPaymentRefNum as ReturnType<typeof vi.fn>).mockResolvedValue([{ qboId: "existing-qbo-pay", qboSyncToken: "1" }]);
    await syncPayment("pay-1", deps);
    expect(deps.paymentSyncLinkRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ qboId: "existing-qbo-pay" })
    );
  });

  it("creates PaymentSyncLink with ERROR status when PaymentRefNum returns multiple results", async () => {
    const deps = makeDeps();
    (deps.qboPaymentPort.createPayment as ReturnType<typeof vi.fn>).mockRejectedValue(new QboDuplicateDocumentError("Duplicate"));
    (deps.qboPaymentPort.findByPaymentRefNum as ReturnType<typeof vi.fn>).mockResolvedValue([
      { qboId: "a", qboSyncToken: "1" },
      { qboId: "b", qboSyncToken: "2" },
    ]);
    await syncPayment("pay-1", deps);
    expect(deps.paymentSyncLinkRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ syncStatus: "ERROR" })
    );
  });
});
