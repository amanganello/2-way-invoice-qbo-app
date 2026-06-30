import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { prisma } from "@/infrastructure/database/prisma.js";
import { syncLinkRepository } from "@/infrastructure/database/sync-link.repository.js";
import { paymentSyncLinkRepository } from "@/infrastructure/database/payment-sync-link.repository.js";
import { reconcileInvoice } from "@/application/sync/reconcile.use-case.js";
import { pullInvoice } from "@/application/sync/pull.use-case.js";
import { syncPayment } from "@/application/sync/payment-sync.use-case.js";
import { auditLogRepository } from "@/infrastructure/database/audit-log.repository.js";
import { encrypt } from "@/shared/crypto/encryption.js";
import { accountMapRepository } from "@/infrastructure/database/account-map.repository.js";
import { itemMapRepository } from "@/infrastructure/database/item-map.repository.js";
import { customerMapRepository } from "@/infrastructure/database/customer-map.repository.js";
import { PrismaInvoiceRepository } from "@/infrastructure/database/invoice.repository.js";
import { PrismaPaymentRepository } from "@/infrastructure/database/payment.repository.js";
import { QBOInvoiceAdapter } from "@/infrastructure/qbo/qbo-invoice.adapter.js";
import { QBOPaymentAdapter } from "@/infrastructure/qbo/qbo-payment.adapter.js";

const QBO_BASE = "https://sandbox-quickbooks.api.intuit.com/v3/company/test-realm";

const server = setupServer(
  // Single handler for all POST /invoice operations — branches on ?operation param
  http.post(`${QBO_BASE}/invoice`, ({ request }) => {
    const url = new URL(request.url);
    const op = url.searchParams.get("operation");
    if (op === "void") {
      return HttpResponse.json({
        Invoice: {
          Id: "QBO-INV-1", SyncToken: "2",
          CustomerRef: { value: "1" }, Line: [],
          MetaData: { CreateTime: "2026-01-01T00:00:00Z", LastUpdatedTime: "2026-06-02T00:00:00Z" },
        },
      });
    }
    if (op === "update") {
      return HttpResponse.json({
        Invoice: {
          Id: "QBO-INV-1", SyncToken: "1",
          CustomerRef: { value: "1" }, Line: [], TotalAmt: 100,
          MetaData: { CreateTime: "2026-01-01T00:00:00Z", LastUpdatedTime: "2026-06-01T00:00:00Z" },
        },
      });
    }
    // create
    return HttpResponse.json({
      Invoice: {
        Id: "QBO-INV-1", SyncToken: "0", DocNumber: "",
        CustomerRef: { value: "1" }, Line: [],
        TotalAmt: 100, DueDate: "2030-01-01", CurrencyRef: { value: "USD" },
        MetaData: { CreateTime: "2026-01-01T00:00:00Z", LastUpdatedTime: "2026-01-01T00:00:00Z" },
      },
    });
  }),
  http.get(`${QBO_BASE}/invoice/QBO-INV-1`, () =>
    HttpResponse.json({
      Invoice: {
        Id: "QBO-INV-1", SyncToken: "1",
        CustomerRef: { value: "1" }, Line: [],
        TotalAmt: 100, DueDate: "2030-01-01", CurrencyRef: { value: "USD" },
        MetaData: { CreateTime: "2026-01-01T00:00:00Z", LastUpdatedTime: "2026-06-01T12:00:00Z" },
      },
    })
  ),
  http.post(`${QBO_BASE}/payment`, () =>
    HttpResponse.json({
      Payment: {
        Id: "QBO-PAY-1", SyncToken: "0",
        CustomerRef: { value: "1" }, TotalAmt: 50,
        MetaData: { CreateTime: "2026-01-01T00:00:00Z", LastUpdatedTime: "2026-01-01T00:00:00Z" },
      },
    })
  )
);

const invoiceRepo = new PrismaInvoiceRepository();
const paymentRepo = new PrismaPaymentRepository();
const qboInvoicePort = new QBOInvoiceAdapter();
const qboPaymentPort = new QBOPaymentAdapter();

const baseDeps = {
  invoiceRepo,
  syncLinkRepo: syncLinkRepository,
  paymentSyncLinkRepo: paymentSyncLinkRepository,
  accountMapRepo: accountMapRepository,
  itemMapRepo: itemMapRepository,
  customerMapRepo: customerMapRepository,
  qboInvoicePort,
  auditLogRepo: auditLogRepository,
  qbDefaultCustomerId: "QBO-CUST-1",
  qbEnvironment: "sandbox",
};

beforeAll(async () => {
  server.listen({ onUnhandledRequest: "error" });
  await prisma.$connect();
  await customerMapRepository.upsertMany([{ internalCustomerId: "cust-1", qboCustomerId: "QBO-CUST-1", qboCustomerName: "Test Customer" }]);
  await qboCredentialsMock();
});

afterAll(async () => {
  server.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.auditLog.deleteMany();
  await prisma.paymentSyncLink.deleteMany();
  await prisma.syncLink.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.invoice.deleteMany();
});

const TEST_KEY = "a".repeat(64);

async function qboCredentialsMock() {
  await prisma.qBOCredentials.upsert({
    where: { id: (await prisma.qBOCredentials.findFirst())?.id ?? "" },
    create: {
      encryptedAccessToken: encrypt("test-token", TEST_KEY),
      encryptedRefreshToken: encrypt("test-refresh", TEST_KEY),
      expiresAt: new Date(Date.now() + 3600 * 1000),
      refreshTokenExpiresAt: new Date(Date.now() + 100 * 24 * 3600 * 1000),
    },
    update: {},
  });
}

describe("Integration: sync round-trips", () => {
  it("internal create → push to QBO → SyncLink created", async () => {
    const invoice = await invoiceRepo.save({
      id: "inv-integration-1", customerId: "cust-1", lineItems: [],
      totalAmount: 100, currency: "USD", status: "sent",
      dueDate: new Date("2030-01-01"), createdAt: new Date(), updatedAt: new Date(),
    });

    await reconcileInvoice(invoice.id, baseDeps);

    const syncLink = await syncLinkRepository.findByInternalId(invoice.id);
    expect(syncLink).not.toBeNull();
    expect(syncLink?.qboId).toBe("QBO-INV-1");
    expect(syncLink?.syncStatus).toBe("SYNCED");
  });

  it("webhook pull → internal invoice updated", async () => {
    const invoice = await invoiceRepo.save({
      id: "inv-integration-2", customerId: "cust-1", lineItems: [],
      totalAmount: 100, currency: "USD", status: "sent",
      dueDate: new Date("2030-01-01"), createdAt: new Date(), updatedAt: new Date(),
    });
    await reconcileInvoice(invoice.id, baseDeps);

    // Simulate pull (QBO webhook)
    await pullInvoice("QBO-INV-1", "Update", "evt-test", {
      invoiceRepo, syncLinkRepo: syncLinkRepository, qboInvoicePort, auditLogRepo: auditLogRepository,
    });

    const syncLink = await syncLinkRepository.findByInternalId(invoice.id);
    expect(syncLink?.syncStatus).toBe("SYNCED");
    expect(syncLink?.qboSyncToken).toBe("1");
  });

  it("duplicate webhook → second event silently skipped (stale check)", async () => {
    const invoice = await invoiceRepo.save({
      id: "inv-integration-3", customerId: "cust-1", lineItems: [],
      totalAmount: 100, currency: "USD", status: "sent",
      dueDate: new Date("2030-01-01"), createdAt: new Date(), updatedAt: new Date(),
    });
    await reconcileInvoice(invoice.id, baseDeps);
    // First pull
    await pullInvoice("QBO-INV-1", "Update", "evt-1", {
      invoiceRepo, syncLinkRepo: syncLinkRepository, qboInvoicePort, auditLogRepo: auditLogRepository,
    });
    // Second pull with same/older timestamp — should be skipped
    const link = await syncLinkRepository.findByInternalId(invoice.id);
    const auditsBefore = await auditLogRepository.findBySyncLinkId(link!.id);
    await pullInvoice("QBO-INV-1", "Update", "evt-2", {
      invoiceRepo, syncLinkRepo: syncLinkRepository, qboInvoicePort, auditLogRepo: auditLogRepository,
    });
    const auditsAfter = await auditLogRepository.findBySyncLinkId(link!.id);
    const staleLog = auditsAfter.find(a => a.action === "skipped_stale");
    expect(staleLog).toBeDefined();
  });

  it("internal void → QBO void called", async () => {
    const invoice = await invoiceRepo.save({
      id: "inv-integration-4", customerId: "cust-1", lineItems: [],
      totalAmount: 100, currency: "USD", status: "sent",
      dueDate: new Date("2030-01-01"), createdAt: new Date(), updatedAt: new Date(),
    });
    await reconcileInvoice(invoice.id, baseDeps);
    await invoiceRepo.save({ ...invoice, status: "void", updatedAt: new Date() });
    await reconcileInvoice(invoice.id, baseDeps);

    const syncLink = await syncLinkRepository.findByInternalId(invoice.id);
    expect(syncLink?.syncStatus).toBe("SYNCED");
    const logs = await auditLogRepository.findBySyncLinkId(syncLink!.id);
    expect(logs.some(l => l.action === "void_pushed")).toBe(true);
  });

  it("QBO void webhook → internal invoice status set to void", async () => {
    const invoice = await invoiceRepo.save({
      id: "inv-integration-5", customerId: "cust-1", lineItems: [],
      totalAmount: 100, currency: "USD", status: "sent",
      dueDate: new Date("2030-01-01"), createdAt: new Date(), updatedAt: new Date(),
    });
    await reconcileInvoice(invoice.id, baseDeps);

    await pullInvoice("QBO-INV-1", "Void", "evt-void", {
      invoiceRepo, syncLinkRepo: syncLinkRepository, qboInvoicePort, auditLogRepo: auditLogRepository,
    });

    const updated = await invoiceRepo.findById(invoice.id);
    expect(updated?.status).toBe("void");
  });

  it("payment sync → PaymentSyncLink created", async () => {
    const invoice = await invoiceRepo.save({
      id: "inv-integration-6", customerId: "cust-1", lineItems: [],
      totalAmount: 100, currency: "USD", status: "sent",
      dueDate: new Date("2030-01-01"), createdAt: new Date(), updatedAt: new Date(),
    });
    await reconcileInvoice(invoice.id, baseDeps);

    const payment = await paymentRepo.save({
      id: "pay-integration-1", invoiceId: invoice.id,
      amount: 50, currency: "USD", paidAt: new Date(),
    });

    await syncPayment(payment.id, {
      paymentRepo,
      invoiceRepo,
      paymentSyncLinkRepo: paymentSyncLinkRepository,
      syncLinkRepo: syncLinkRepository,
      customerMapRepo: customerMapRepository,
      qboPaymentPort,
      auditLogRepo: auditLogRepository,
      qbDefaultCustomerId: "QBO-CUST-1",
      qbEnvironment: "sandbox",
    });

    const link = await paymentSyncLinkRepository.findByInternalId(payment.id);
    expect(link).not.toBeNull();
    expect(link?.qboId).toBe("QBO-PAY-1");
    expect(link?.syncStatus).toBe("SYNCED");
  });

  it("partially paid invoice edit → update blocked", async () => {
    const invoice = await invoiceRepo.save({
      id: "inv-integration-7", customerId: "cust-1", lineItems: [],
      totalAmount: 100, currency: "USD", status: "sent",
      dueDate: new Date("2030-01-01"), createdAt: new Date(), updatedAt: new Date(),
    });
    await reconcileInvoice(invoice.id, baseDeps);
    // Create a PaymentSyncLink to simulate linked payment
    await paymentSyncLinkRepository.create({
      internalId: "pay-block-test", qboId: "QBO-PAY-X",
      invoiceInternalId: invoice.id, syncStatus: "SYNCED",
    });
    // Modify lineItems so the guard detects a change against lastSyncedSnapshot
    await invoiceRepo.save({
      ...invoice,
      lineItems: [{ description: "new item", quantity: 1, unitPrice: 100, amount: 100 }],
      updatedAt: new Date(),
    });
    // Now try to update — should throw ConflictError
    await expect(reconcileInvoice(invoice.id, baseDeps)).rejects.toThrow("linked payment");
  });
});
