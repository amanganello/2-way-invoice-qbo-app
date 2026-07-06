import { describe, it, expect } from "vitest";
import { detectConflicts } from "@/application/sync/conflict-detection.js";
import { toCurrencyCode, toMoney, type Invoice } from "@/domain/invoices/invoice.types.js";

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "inv-1",
    customerId: "cust-1",
    lineItems: [{ description: "Service", quantity: 1, unitPrice: toMoney("100.00"), amount: toMoney("100.00") }],
    totalAmount: toMoney("100.00"),
    currency: toCurrencyCode("USD"),
    status: "sent",
    dueDate: new Date("2030-01-01"),
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

describe("detectConflicts", () => {
  it("returns no conflict when nothing changed on either side", () => {
    const snapshot = makeInvoice();
    const result = detectConflicts(snapshot, makeInvoice(), makeInvoice());
    expect(result.hasConflict).toBe(false);
    if (!result.hasConflict) {
      expect(result.mergedInvoice.totalAmount).toBe("100.00");
    }
  });

  it("applies QBO-only change with no conflict (e.g. status=paid from QBO)", () => {
    const snapshot = makeInvoice();
    const internal = makeInvoice(); // unchanged
    const qbo = makeInvoice({ status: "paid" });
    const result = detectConflicts(snapshot, internal, qbo);
    expect(result.hasConflict).toBe(false);
    if (!result.hasConflict) {
      expect(result.mergedInvoice.status).toBe("paid");
    }
  });

  it("keeps internal-only change with no conflict (e.g. lineItems updated internally)", () => {
    const snapshot = makeInvoice();
    const newLine = [{ description: "Updated", quantity: 2, unitPrice: toMoney("50.00"), amount: toMoney("100.00") }];
    const internal = makeInvoice({ lineItems: newLine });
    const qbo = makeInvoice(); // unchanged
    const result = detectConflicts(snapshot, internal, qbo);
    expect(result.hasConflict).toBe(false);
    if (!result.hasConflict) {
      expect(result.mergedInvoice.lineItems).toEqual(newLine);
    }
  });

  it("auto-resolves status conflict in favour of qbo", () => {
    const snapshot = makeInvoice({ status: "sent" });
    const internal = makeInvoice({ status: "overdue" }); // internal changed
    const qbo = makeInvoice({ status: "paid" });          // qbo also changed
    const result = detectConflicts(snapshot, internal, qbo);
    expect(result.hasConflict).toBe(false);
    if (!result.hasConflict) {
      expect(result.mergedInvoice.status).toBe("paid"); // rule: qbo wins
    }
  });

  it("auto-resolves lineItems conflict in favour of internal", () => {
    const snapshot = makeInvoice();
    const newLine = [{ description: "New", quantity: 3, unitPrice: toMoney("40.00"), amount: toMoney("120.00") }];
    const internal = makeInvoice({ lineItems: newLine });
    const qbo = makeInvoice({ lineItems: [{ description: "QBO edit", quantity: 1, unitPrice: toMoney("200.00"), amount: toMoney("200.00") }] });
    const result = detectConflicts(snapshot, internal, qbo);
    expect(result.hasConflict).toBe(false);
    if (!result.hasConflict) {
      expect(result.mergedInvoice.lineItems).toEqual(newLine); // rule: internal wins
    }
  });

  it("flags manual conflict when dueDate changed on both sides", () => {
    const snapshot = makeInvoice({ dueDate: new Date("2030-01-01") });
    const internal = makeInvoice({ dueDate: new Date("2030-02-01") });
    const qbo = makeInvoice({ dueDate: new Date("2030-03-01") });
    const result = detectConflicts(snapshot, internal, qbo);
    expect(result.hasConflict).toBe(true);
    if (result.hasConflict) {
      expect(result.conflictedFields.some(f => f.field === "dueDate")).toBe(true);
    }
  });
});
