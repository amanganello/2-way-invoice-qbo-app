import type { Job } from "bullmq";
import { reconcileInvoice } from "@/application/sync/reconcile.use-case.js";
import { PrismaInvoiceRepository } from "@/infrastructure/database/invoice.repository.js";
import { syncLinkRepository } from "@/infrastructure/database/sync-link.repository.js";
import { paymentSyncLinkRepository } from "@/infrastructure/database/payment-sync-link.repository.js";
import { accountMapRepository } from "@/infrastructure/database/account-map.repository.js";
import { itemMapRepository } from "@/infrastructure/database/item-map.repository.js";
import { customerMapRepository } from "@/infrastructure/database/customer-map.repository.js";
import { auditLogRepository } from "@/infrastructure/database/audit-log.repository.js";
import { QBOInvoiceAdapter } from "@/infrastructure/qbo/qbo-invoice.adapter.js";
import { env } from "@/config/env.js";

const invoiceRepo = new PrismaInvoiceRepository();
const qboInvoicePort = new QBOInvoiceAdapter();

export async function reconcileProcessor(job: Job<{ internalId: string }>): Promise<void> {
  await reconcileInvoice(job.data.internalId, {
    invoiceRepo,
    syncLinkRepo: syncLinkRepository,
    paymentSyncLinkRepo: paymentSyncLinkRepository,
    accountMapRepo: accountMapRepository,
    itemMapRepo: itemMapRepository,
    customerMapRepo: customerMapRepository,
    qboInvoicePort,
    auditLogRepo: auditLogRepository,
    qbDefaultCustomerId: env.QB_DEFAULT_CUSTOMER_ID,
    qbDefaultItemId: env.QB_DEFAULT_ITEM_ID,
    qbEnvironment: env.QB_ENVIRONMENT,
  });
}
