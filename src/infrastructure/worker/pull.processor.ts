import type { Job } from "bullmq";
import { pullInvoice } from "@/application/sync/pull.use-case.js";
import { PrismaInvoiceRepository } from "@/infrastructure/database/invoice.repository.js";
import { syncLinkRepository } from "@/infrastructure/database/sync-link.repository.js";
import { auditLogRepository } from "@/infrastructure/database/audit-log.repository.js";
import { QBOInvoiceAdapter } from "@/infrastructure/qbo/qbo-invoice.adapter.js";
import { eventLogRepository } from "@/infrastructure/database/event-log.repository.js";
import logger from "@/infrastructure/logger/index.js";

const invoiceRepo = new PrismaInvoiceRepository();
const qboInvoicePort = new QBOInvoiceAdapter();

export async function pullProcessor(
  job: Job<{ qboId: string; eventType: string; eventId: string }>
): Promise<void> {
  const { qboId, eventType, eventId } = job.data;

  const status = await eventLogRepository.findStatus(eventId);
  if (status === "PROCESSED") {
    logger.debug({ eventId }, "pullProcessor: event already processed — skipping");
    return;
  }

  try {
    await pullInvoice(qboId, eventType, eventId, {
      invoiceRepo,
      syncLinkRepo: syncLinkRepository,
      qboInvoicePort,
      auditLogRepo: auditLogRepository,
    });

    await eventLogRepository.markProcessed(eventId);
  } catch (err) {
    await eventLogRepository.markFailed(eventId);
    throw err;
  }
}
