import { describe, it, expect, beforeAll } from "vitest";
import { PrismaInvoiceRepository } from "@/infrastructure/database/invoice.repository.js";
import { PrismaPaymentRepository } from "@/infrastructure/database/payment.repository.js";
import { QBOInvoiceAdapter } from "@/infrastructure/qbo/qbo-invoice.adapter.js";
import { QBOPaymentAdapter } from "@/infrastructure/qbo/qbo-payment.adapter.js";
import { qboCredentialsRepository } from "@/infrastructure/database/qbo-credentials.repository.js";
import { reconcileInvoice } from "@/application/sync/reconcile.use-case.js";
import { syncLinkRepository } from "@/infrastructure/database/sync-link.repository.js";
import { paymentSyncLinkRepository } from "@/infrastructure/database/payment-sync-link.repository.js";
import { accountMapRepository } from "@/infrastructure/database/account-map.repository.js";
import { itemMapRepository } from "@/infrastructure/database/item-map.repository.js";
import { customerMapRepository } from "@/infrastructure/database/customer-map.repository.js";
import { auditLogRepository } from "@/infrastructure/database/audit-log.repository.js";
import { qboClient } from "@/infrastructure/qbo/qbo.client.js";
import { syncPayment } from "@/application/sync/payment-sync.use-case.js";

// SANDBOX tests — run manually with real QBO credentials
// pnpm exec vitest run src/tests/sandbox/ --config vitest.integration.config.ts
// Requires: QB_* env vars pointing to a live sandbox account + tokens in DB

const invoiceRepo = new PrismaInvoiceRepository();
const paymentRepo = new PrismaPaymentRepository();
const qboInvoicePort = new QBOInvoiceAdapter();
const qboPaymentPort = new QBOPaymentAdapter();

describe("Sandbox: real QBO API", () => {
  beforeAll(async () => {
    const creds = await qboCredentialsRepository.get();
    if (!creds) throw new Error("No QBO credentials found. Run: pnpm tsx scripts/qbo-auth.ts");
  });

  it("fetches QBO account list (validates credentials)", async () => {
    type R = { QueryResponse: { Account?: { Id: string; Name: string }[] } };
    const res = await qboClient.request<R>("GET", "/query?query=SELECT * FROM Account&minorversion=65");
    expect(Array.isArray(res.QueryResponse.Account ?? [])).toBe(true);
  }, 15000);

  it("full invoice lifecycle: create → update → void", async () => {
    const invoice = await invoiceRepo.save({
      id: `sandbox-${Date.now()}`, customerId: "sandbox-cust",
      lineItems: [{ description: "Sandbox test", quantity: 1, unitPrice: 10, amount: 10 }],
      totalAmount: 10, currency: "USD", status: "sent",
      dueDate: new Date("2030-12-31"), createdAt: new Date(), updatedAt: new Date(),
    });

    const deps = {
      invoiceRepo, syncLinkRepo: syncLinkRepository,
      paymentSyncLinkRepo: paymentSyncLinkRepository,
      accountMapRepo: accountMapRepository, itemMapRepo: itemMapRepository,
      customerMapRepo: customerMapRepository, qboInvoicePort,
      auditLogRepo: auditLogRepository,
      qbDefaultCustomerId: process.env.QB_DEFAULT_CUSTOMER_ID,
      qbEnvironment: process.env.QB_ENVIRONMENT ?? "sandbox",
    };

    // Create
    await reconcileInvoice(invoice.id, deps);
    const link = await syncLinkRepository.findByInternalId(invoice.id);
    expect(link?.qboId).toBeTruthy();
    expect(link?.syncStatus).toBe("SYNCED");

    // Update
    await invoiceRepo.save({ ...invoice, totalAmount: 20, updatedAt: new Date() });
    await reconcileInvoice(invoice.id, deps);
    const linkAfterUpdate = await syncLinkRepository.findByInternalId(invoice.id);
    expect(linkAfterUpdate?.syncStatus).toBe("SYNCED");

    // Void
    await invoiceRepo.save({ ...invoice, status: "void", updatedAt: new Date() });
    await reconcileInvoice(invoice.id, deps);
    const linkAfterVoid = await syncLinkRepository.findByInternalId(invoice.id);
    expect(linkAfterVoid?.syncStatus).toBe("SYNCED");
  }, 30000);
});
