import type { Job } from "bullmq";
import { pullInvoice } from "@/application/sync/pull.use-case.js";
import { PrismaInvoiceRepository } from "@/infrastructure/database/invoice.repository.js";
import { syncLinkRepository } from "@/infrastructure/database/sync-link.repository.js";
import { auditLogRepository } from "@/infrastructure/database/audit-log.repository.js";
import { QBOInvoiceAdapter } from "@/infrastructure/qbo/qbo-invoice.adapter.js";

const invoiceRepo = new PrismaInvoiceRepository();
const qboInvoicePort = new QBOInvoiceAdapter();

export async function pullProcessor(
  job: Job<{ qboId: string; eventType: string; eventId: string }>
): Promise<void> {
  await pullInvoice(job.data.qboId, job.data.eventType, job.data.eventId, {
    invoiceRepo,
    syncLinkRepo: syncLinkRepository,
    qboInvoicePort,
    auditLogRepo: auditLogRepository,
  });
}
