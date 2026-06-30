import type { Job } from "bullmq";
import { syncPayment } from "@/application/sync/payment-sync.use-case.js";
import { PrismaPaymentRepository } from "@/infrastructure/database/payment.repository.js";
import { PrismaInvoiceRepository } from "@/infrastructure/database/invoice.repository.js";
import { paymentSyncLinkRepository } from "@/infrastructure/database/payment-sync-link.repository.js";
import { syncLinkRepository } from "@/infrastructure/database/sync-link.repository.js";
import { customerMapRepository } from "@/infrastructure/database/customer-map.repository.js";
import { auditLogRepository } from "@/infrastructure/database/audit-log.repository.js";
import { QBOPaymentAdapter } from "@/infrastructure/qbo/qbo-payment.adapter.js";
import { env } from "@/config/env.js";

const paymentRepo = new PrismaPaymentRepository();
const invoiceRepo = new PrismaInvoiceRepository(); // needed for customerId resolution
const qboPaymentPort = new QBOPaymentAdapter();

export async function paymentProcessor(job: Job<{ internalPaymentId: string }>): Promise<void> {
  await syncPayment(job.data.internalPaymentId, {
    paymentRepo,
    invoiceRepo,
    paymentSyncLinkRepo: paymentSyncLinkRepository,
    syncLinkRepo: syncLinkRepository,
    customerMapRepo: customerMapRepository,
    qboPaymentPort,
    auditLogRepo: auditLogRepository,
    qbDefaultCustomerId: env.QB_DEFAULT_CUSTOMER_ID,
    qbEnvironment: env.QB_ENVIRONMENT,
  });
}
