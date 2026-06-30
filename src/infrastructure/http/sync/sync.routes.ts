import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "@/infrastructure/database/prisma.js";
import { syncLinkRepository } from "@/infrastructure/database/sync-link.repository.js";
import { auditLogRepository } from "@/infrastructure/database/audit-log.repository.js";
import { accountMapRepository } from "@/infrastructure/database/account-map.repository.js";
import { itemMapRepository } from "@/infrastructure/database/item-map.repository.js";
import { customerMapRepository } from "@/infrastructure/database/customer-map.repository.js";
import { qboClient } from "@/infrastructure/qbo/qbo.client.js";
import { invoiceSyncQueue } from "@/infrastructure/queue/queues.js";
import type { SyncStatus } from "@prisma/client";
import type { QBOAccount, QBOItem, QBOCustomer } from "@/infrastructure/qbo/qbo.types.js";
import { SyncLinksQuerySchema, SyncLinkParamsSchema, ResolveConflictSchema } from "./sync.schemas.js";
import { NotFoundError } from "@/shared/errors/app-error.js";
import { PrismaInvoiceRepository } from "@/infrastructure/database/invoice.repository.js";

const invoiceRepo = new PrismaInvoiceRepository();

export async function registerSyncRoutes(app: FastifyInstance): Promise<void> {
  // GET /sync/links
  app.get("/sync/links", async (request: FastifyRequest, reply: FastifyReply) => {
    const { syncStatus, limit } = SyncLinksQuerySchema.parse(request.query);
    const rows = await prisma.syncLink.findMany({
      where: syncStatus ? { syncStatus: syncStatus as SyncStatus } : undefined,
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return reply.send(rows);
  });

  // GET /sync/links/:id
  app.get("/sync/links/:id", async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = SyncLinkParamsSchema.parse(request.params);
    const row = await prisma.syncLink.findUnique({ where: { id } });
    if (!row) throw new NotFoundError(`SyncLink ${id} not found`);
    const logs = await auditLogRepository.findBySyncLinkId(id);
    return reply.send({ ...row, auditLogs: logs });
  });

  // GET /sync/conflicts
  app.get("/sync/conflicts", async (request: FastifyRequest, reply: FastifyReply) => {
    const { limit } = SyncLinksQuerySchema.parse(request.query);
    const rows = await prisma.syncLink.findMany({
      where: { syncStatus: "CONFLICT" },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { auditLogs: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    return reply.send(rows);
  });

  // POST /sync/conflicts/:id/resolve
  app.post("/sync/conflicts/:id/resolve", async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = SyncLinkParamsSchema.parse(request.params);
    const { strategy } = ResolveConflictSchema.parse(request.body);

    const syncLink = await prisma.syncLink.findUnique({ where: { id } });
    if (!syncLink || syncLink.syncStatus !== "CONFLICT") {
      throw new NotFoundError(`No CONFLICT SyncLink with id ${id}`);
    }

    // Apply chosen strategy
    if (strategy === "accept-internal") {
      await syncLinkRepository.setStatus(syncLink.id, syncLink.version, "PENDING", {});
    } else {
      // accept-qbo: fetch QBO state and overwrite internal
      if (syncLink.qboId) {
        const { QBOInvoiceAdapter } = await import("@/infrastructure/qbo/qbo-invoice.adapter.js");
        const adapter = new QBOInvoiceAdapter();
        const qboResult = await adapter.getInvoice(syncLink.qboId);
        const internal = await invoiceRepo.findById(syncLink.internalId);
        if (internal) {
          await invoiceRepo.save({ ...internal, ...qboResult.invoice, id: internal.id, createdAt: internal.createdAt, updatedAt: new Date() });
        }
      }
      await syncLinkRepository.setStatus(syncLink.id, syncLink.version, "PENDING", {});
    }

    // Re-trigger sync
    await invoiceSyncQueue.add("reconcile", { internalId: syncLink.internalId }, { jobId: `reconcile-${syncLink.internalId}` });

    return reply.send({ ok: true, strategy, internalId: syncLink.internalId });
  });

  // POST /sync/initial-load/internal-to-qbo
  app.post("/sync/initial-load/internal-to-qbo", async (_request: FastifyRequest, reply: FastifyReply) => {
    const invoices = await prisma.invoice.findMany();
    let enqueued = 0;
    let skipped = 0;

    for (const invoice of invoices) {
      const existing = await syncLinkRepository.findByInternalId(invoice.id);
      if (existing) { skipped++; continue; }

      // Write SyncLink PENDING first, then enqueue
      await syncLinkRepository.create({ internalId: invoice.id, internalUpdatedAt: invoice.updatedAt, syncStatus: "PENDING" });
      await invoiceSyncQueue.add("reconcile", { internalId: invoice.id }, { jobId: `reconcile-${invoice.id}` });
      enqueued++;
    }

    return reply.send({ enqueued, skipped });
  });

  // POST /sync/initial-load/qbo-to-internal — not implemented
  app.post("/sync/initial-load/qbo-to-internal", async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.status(501).send({
      error: "NotImplemented",
      statusCode: 501,
      message: "qbo-to-internal initial load is not implemented in this version. See README Tradeoffs section.",
    });
  });

  // POST /sync/mappings/import
  app.post("/sync/mappings/import", async (_request: FastifyRequest, reply: FastifyReply) => {
    type AccountQueryShape = { QueryResponse: { Account?: QBOAccount[] } };
    type ItemQueryShape = { QueryResponse: { Item?: QBOItem[] } };
    type CustomerQueryShape = { QueryResponse: { Customer?: QBOCustomer[] } };

    const [accountsRaw, itemsRaw, customersRaw] = await Promise.all([
      qboClient.request<AccountQueryShape>("GET", `/query?query=${encodeURIComponent("SELECT * FROM Account WHERE AccountType='Income'")}&minorversion=65`),
      qboClient.request<ItemQueryShape>("GET", `/query?query=${encodeURIComponent("SELECT * FROM Item")}&minorversion=65`),
      qboClient.request<CustomerQueryShape>("GET", `/query?query=${encodeURIComponent("SELECT * FROM Customer WHERE Active=true")}&minorversion=65`),
    ]);

    const accountsImported = await accountMapRepository.upsertMany(
      (accountsRaw.QueryResponse.Account ?? []).map(a => ({
        internalAccountCode: a.FullyQualifiedName,
        qboAccountId: a.Id,
        qboAccountName: a.Name,
      }))
    );

    const itemsImported = await itemMapRepository.upsertMany(
      (itemsRaw.QueryResponse.Item ?? []).map(i => ({
        internalItemCode: i.Name,
        qboItemId: i.Id,
        qboItemName: i.Name,
        defaultTaxCode: i.TaxCodeRef?.value ?? "NON",
      }))
    );

    const customersImported = await customerMapRepository.upsertMany(
      (customersRaw.QueryResponse.Customer ?? []).map(c => ({
        internalCustomerId: c.Id,
        qboCustomerId: c.Id,
        qboCustomerName: c.DisplayName,
      }))
    );

    return reply.send({ accountsImported, itemsImported, customersImported });
  });

  // GET /sync/mappings
  app.get("/sync/mappings", async (_request: FastifyRequest, reply: FastifyReply) => {
    const [accounts, items, customers] = await Promise.all([
      accountMapRepository.findAll(),
      itemMapRepository.findAll(),
      customerMapRepository.findAll(),
    ]);
    return reply.send({ accounts, items, customers });
  });
}
