import { describe, it, expect } from "vitest";
import { deriveInvoiceStatus } from "@/infrastructure/qbo/qbo-invoice.adapter.js";
import type { QBOInvoiceEntity } from "@/infrastructure/qbo/qbo.types.js";

const base: QBOInvoiceEntity = {
  Id: "1",
  SyncToken: "0",
  CustomerRef: { value: "cust-1", name: "Test" },
};

describe("deriveInvoiceStatus", () => {
  it("returns void when no lines and TotalAmt is 0", () => {
    expect(deriveInvoiceStatus({ ...base, Line: [], TotalAmt: 0 })).toBe("void");
  });

  it("returns void when Line is undefined and TotalAmt is 0", () => {
    expect(deriveInvoiceStatus({ ...base, TotalAmt: 0 })).toBe("void");
  });

  it("returns draft when DocNumber is absent", () => {
    expect(deriveInvoiceStatus({ ...base, Line: [{ Amount: 100, DetailType: "SalesItemLineDetail" }] })).toBe("draft");
  });

  it("returns sent when DocNumber present and has lines", () => {
    expect(deriveInvoiceStatus({ ...base, DocNumber: "INV-001", Line: [{ Amount: 100, DetailType: "SalesItemLineDetail" }] })).toBe("sent");
  });

  it("returns void when TotalAmt is 0 even with a DocNumber", () => {
    expect(deriveInvoiceStatus({ ...base, DocNumber: "INV-001", Line: [], TotalAmt: 0 })).toBe("void");
  });
});
