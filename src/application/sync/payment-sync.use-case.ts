import type { PaymentRepository, InvoiceRepository, QBOPaymentPort } from "@/domain/invoices/invoice.types.js";
// ARCHITECTURE NOTE: PaymentSyncLinkRepository, SyncLinkRepository, and AuditLogRepository
// are imported from infrastructure/ into the application layer. These are type-only imports
// used structurally — no concrete infrastructure code executes here. See README "Known
// Limitations" and pull.use-case.ts for the same pattern and rationale.
import type { PaymentSyncLinkRepository } from "@/infrastructure/database/payment-sync-link.repository.js";
import type { SyncLinkRepository } from "@/infrastructure/database/sync-link.repository.js";
import type { AuditLogRepository } from "@/infrastructure/database/audit-log.repository.js";
import logger from "@/infrastructure/logger/index.js";
import { ExternalServiceError } from "@/shared/errors/app-error.js";

export type PaymentSyncDeps = {
  paymentRepo: PaymentRepository;
  invoiceRepo: InvoiceRepository; // needed to resolve customerId for CustomerMap lookup
  paymentSyncLinkRepo: PaymentSyncLinkRepository;
  syncLinkRepo: SyncLinkRepository;
  customerMapRepo: { findByInternalId: (id: string) => Promise<{ qboCustomerId: string } | null> };
  qboPaymentPort: QBOPaymentPort;
  auditLogRepo: AuditLogRepository;
  qbDefaultCustomerId?: string;
  qbEnvironment: string;
};

export async function syncPayment(internalPaymentId: string, deps: PaymentSyncDeps): Promise<void> {
  const {
    paymentRepo,
    invoiceRepo,
    paymentSyncLinkRepo,
    syncLinkRepo,
    customerMapRepo,
    qboPaymentPort,
    auditLogRepo,
    qbDefaultCustomerId,
    qbEnvironment,
  } = deps;

  // Idempotency: skip if already synced
  const existing = await paymentSyncLinkRepo.findByInternalId(internalPaymentId);
  if (existing) return;

  const payment = await paymentRepo.findById(internalPaymentId);
  if (!payment) {
    logger.warn({ internalPaymentId }, "syncPayment: payment not found");
    return;
  }

  // Find QBO invoice ID via SyncLink
  const syncLink = await syncLinkRepo.findByInternalId(payment.invoiceId);
  if (!syncLink?.qboId) {
    throw new ExternalServiceError(`No SyncLink with qboId found for invoice ${payment.invoiceId}`);
  }

  // Resolve customer — look up invoice to get customerId, then map to QBO.
  // Do NOT pass payment.invoiceId to customerMapRepo: CustomerMap is keyed by
  // internal customer ID, not invoice ID. Passing invoiceId always misses.
  const invoice = await invoiceRepo.findById(payment.invoiceId);
  if (!invoice) {
    throw new ExternalServiceError(
      `Invoice ${payment.invoiceId} not found for payment ${internalPaymentId}`
    );
  }
  const customerEntry = await customerMapRepo.findByInternalId(invoice.customerId);
  let customerRef: string;
  if (customerEntry) {
    customerRef = customerEntry.qboCustomerId;
  } else if (qbEnvironment === "sandbox" && qbDefaultCustomerId) {
    customerRef = qbDefaultCustomerId;
  } else {
    throw new ExternalServiceError(`No CustomerMap entry for customer: ${invoice.customerId}`);
  }

  const sourceEventId = `payment-${internalPaymentId}`;

  try {
    let qboId: string;
    let syncStatus: "SYNCED" | "ERROR" = "SYNCED";

    try {
      const result = await qboPaymentPort.createPayment(payment, customerRef, syncLink.qboId);
      qboId = result.qboId;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes("duplicate")) {
        const matches = await qboPaymentPort.findByPaymentRefNum(payment.id);
        if (matches.length === 1) {
          qboId = matches[0].qboId;
        } else if (matches.length > 1) {
          logger.warn({ paymentRefNum: payment.id }, "PaymentRefNum not unique in QBO — manual review required");
          qboId = matches[0].qboId;
          syncStatus = "ERROR";
        } else {
          throw err;
        }
      } else {
        throw err;
      }
    }

    await paymentSyncLinkRepo.create({
      internalId: internalPaymentId,
      qboId,
      invoiceInternalId: payment.invoiceId,
      syncStatus,
    });

    await auditLogRepo.create({
      syncLinkId: syncLink.id,
      action: "payment_synced_to_qbo",
      sourceEventId,
      result: "SUCCESS",
      afterState: { qboPaymentId: qboId },
    });
  } catch (err) {
    await auditLogRepo.create({
      syncLinkId: syncLink.id,
      action: "payment_sync_failed",
      sourceEventId,
      result: "FAILURE",
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
