import { describe, it, expect, vi } from "vitest";
import { syncPayment } from "@/application/sync/payment-sync.use-case";
import type { Payment } from "@/domain/invoices/invoice.types";

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return { id: "pay-1", invoiceId: "inv-1", amount: "100.00", currency: "USD", paidAt: new Date(), ...overrides };
}

function makeDeps() {
  return {
    paymentRepo: { findById: vi.fn(async () => makePayment()) },
    // invoiceRepo required: syncPayment looks up the invoice to get customerId,
    // then passes customerId (not invoiceId) to customerMapRepo.findByInternalId.
    invoiceRepo: {
      findById: vi.fn(async () => ({
        id: "inv-1",
        customerId: "cust-1",
        lineItems: [],
        totalAmount: "100.00",
        currency: "USD",
        status: "sent" as const,
        dueDate: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
      save: vi.fn(async (i: unknown) => i),
    },
    paymentSyncLinkRepo: { findByInternalId: vi.fn(async () => null), create: vi.fn(async (d: unknown) => d) },
    syncLinkRepo: { findByInternalId: vi.fn(async () => ({ qboId: "qbo-inv-1", id: "sl-1" })) },
    customerMapRepo: {
      // Must receive customerId ("cust-1"), NOT invoiceId ("inv-1")
      findByInternalId: vi.fn(async (id: string) => {
        if (id === "cust-1") return { qboCustomerId: "QBO-CUST" };
        return null;
      }),
    },
    qboPaymentPort: {
      createPayment: vi.fn(async () => ({ qboId: "qbo-pay-1", qboSyncToken: "0" })),
      findByPaymentRefNum: vi.fn(async () => []),
    },
    auditLogRepo: { create: vi.fn(async () => {}) },
    qbDefaultCustomerId: undefined,
    qbEnvironment: "sandbox",
  };
}

describe("syncPayment", () => {
  it("creates payment in QBO and creates PaymentSyncLink", async () => {
    const deps = makeDeps();
    await syncPayment("pay-1", deps as never);
    expect(deps.qboPaymentPort.createPayment).toHaveBeenCalledOnce();
    expect(deps.paymentSyncLinkRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ internalId: "pay-1", qboId: "qbo-pay-1", invoiceInternalId: "inv-1" })
    );
  });

  it("skips when PaymentSyncLink already exists (idempotent)", async () => {
    const deps = makeDeps();
    (deps.paymentSyncLinkRepo.findByInternalId as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "existing" });
    await syncPayment("pay-1", deps as never);
    expect(deps.qboPaymentPort.createPayment).not.toHaveBeenCalled();
  });

  it("finds existing payment by PaymentRefNum on duplicate error and links it", async () => {
    const deps = makeDeps();
    (deps.qboPaymentPort.createPayment as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Duplicate"));
    (deps.qboPaymentPort.findByPaymentRefNum as ReturnType<typeof vi.fn>).mockResolvedValue([{ qboId: "existing-qbo-pay", qboSyncToken: "1" }]);
    await syncPayment("pay-1", deps as never);
    expect(deps.paymentSyncLinkRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ qboId: "existing-qbo-pay" })
    );
  });

  it("creates PaymentSyncLink with ERROR status when PaymentRefNum returns multiple results", async () => {
    const deps = makeDeps();
    (deps.qboPaymentPort.createPayment as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Duplicate"));
    (deps.qboPaymentPort.findByPaymentRefNum as ReturnType<typeof vi.fn>).mockResolvedValue([
      { qboId: "a", qboSyncToken: "1" },
      { qboId: "b", qboSyncToken: "2" },
    ]);
    await syncPayment("pay-1", deps as never);
    expect(deps.paymentSyncLinkRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ syncStatus: "ERROR" })
    );
  });
});
