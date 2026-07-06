import type { Job } from "bullmq";
import { pullInvoice } from "@/application/sync/pull.use-case.js";
import { PrismaInvoiceRepository } from "@/infrastructure/database/invoice.repository.js";
import { syncLinkRepository } from "@/infrastructure/database/sync-link.repository.js";
import { auditLogRepository } from "@/infrastructure/database/audit-log.repository.js";
import { QBOInvoiceAdapter } from "@/infrastructure/qbo/qbo-invoice.adapter.js";
import { prisma } from "@/infrastructure/database/prisma.js";
import logger from "@/infrastructure/logger/index.js";

const invoiceRepo = new PrismaInvoiceRepository();
const qboInvoicePort = new QBOInvoiceAdapter();

export async function pullProcessor(
  job: Job<{ qboId: string; eventType: string; eventId: string }>
): Promise<void> {
  const { qboId, eventType, eventId } = job.data;

  const logEntry = await prisma.eventLog.findUnique({ where: { eventId } });
  if (logEntry?.status === "PROCESSED") {
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

    await prisma.eventLog.updateMany({
      where: { eventId },
      data: { status: "PROCESSED", processedAt: new Date() },
    });
  } catch (err) {
    // FAILED means the latest attempt failed, not terminal failure.
    // BullMQ will retry this job, and webhook re-delivery may re-enqueue FAILED events.
    await prisma.eventLog.updateMany({
      where: { eventId },
      data: { status: "FAILED" },
    });
    throw err;
  }
}
