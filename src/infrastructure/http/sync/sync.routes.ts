import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { accountMapRepository } from "@/infrastructure/database/account-map.repository.js";
import { auditLogRepository } from "@/infrastructure/database/audit-log.repository.js";
import { customerMapRepository } from "@/infrastructure/database/customer-map.repository.js";
import { itemMapRepository } from "@/infrastructure/database/item-map.repository.js";
import { syncLinkRepository } from "@/infrastructure/database/sync-link.repository.js";
import { syncQueue } from "@/infrastructure/queue/queues.js";
import { QBOCatalogAdapter } from "@/infrastructure/qbo/qbo-catalog.adapter.js";
import { QBOInvoiceAdapter } from "@/infrastructure/qbo/qbo-invoice.adapter.js";
import { PrismaInvoiceRepository } from "@/infrastructure/database/invoice.repository.js";
import {
  getSyncLinkDetail,
  importQboMappings,
  listConflicts,
  listMappings,
  listSyncLinks,
  resolveConflict,
  runInitialInternalLoad,
  runInitialQboLoad,
  type SyncManagementDeps,
} from "@/application/sync/sync-management.use-cases.js";
import { QboInitialLoadQuerySchema, ResolveConflictSchema, SyncLinkParamsSchema, SyncLinksQuerySchema } from "./sync.schemas.js";

const deps: SyncManagementDeps = {
  syncLinkRepo: syncLinkRepository,
  auditLogRepo: auditLogRepository,
  queue: syncQueue,
  qboCatalog: new QBOCatalogAdapter(),
  accountMapRepo: accountMapRepository,
  itemMapRepo: itemMapRepository,
  customerMapRepo: customerMapRepository,
};

export async function registerSyncRoutes(app: FastifyInstance): Promise<void> {
  app.get("/sync/links", async (request: FastifyRequest, reply: FastifyReply) => {
    const query = SyncLinksQuerySchema.parse(request.query);
    return reply.send(await listSyncLinks(deps, query));
  });

  app.get("/sync/links/:id", async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = SyncLinkParamsSchema.parse(request.params);
    return reply.send(await getSyncLinkDetail(deps, id));
  });

  app.get("/sync/conflicts", async (request: FastifyRequest, reply: FastifyReply) => {
    const { limit } = SyncLinksQuerySchema.parse(request.query);
    return reply.send(await listConflicts(deps, limit));
  });

  app.post("/sync/conflicts/:id/resolve", async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = SyncLinkParamsSchema.parse(request.params);
    const { strategy } = ResolveConflictSchema.parse(request.body);
    return reply.send(await resolveConflict(
      {
        syncLinkRepo: deps.syncLinkRepo,
        queue: deps.queue,
        invoiceRepo: new PrismaInvoiceRepository(),
        qboInvoicePort: new QBOInvoiceAdapter(),
      },
      id,
      strategy
    ));
  });

  app.post("/sync/initial-load/internal-to-qbo", async (request: FastifyRequest, reply: FastifyReply) => {
    const { limit } = SyncLinksQuerySchema.parse(request.query);
    return reply.send(await runInitialInternalLoad(deps, limit));
  });

  app.post("/sync/initial-load/qbo-to-internal", async (request: FastifyRequest, reply: FastifyReply) => {
    const { limit, startPosition } = QboInitialLoadQuerySchema.parse(request.query);
    return reply.send(await runInitialQboLoad(
      {
        syncLinkRepo: deps.syncLinkRepo,
        invoiceRepo: new PrismaInvoiceRepository(),
        qboInvoicePort: new QBOInvoiceAdapter(),
      },
      { limit, startPosition }
    ));
  });

  app.post("/sync/mappings/import", async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(await importQboMappings(deps));
  });

  app.get("/sync/mappings", async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(await listMappings(deps));
  });
}
