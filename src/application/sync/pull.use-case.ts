import type { InvoiceRepository, QBOInvoicePort } from "@/domain/invoices/invoice.types.js";
import type { AuditLogPort, SyncLinkPort } from "@/application/ports/sync.ports.js";
import { detectConflicts } from "./conflict-detection.js";
import logger from "@/infrastructure/logger/index.js";
import { invoiceToSnapshot, snapshotToInvoice } from "./invoice-snapshot.js";

export type PullDeps = {
  invoiceRepo: InvoiceRepository;
  syncLinkRepo: SyncLinkPort;
  qboInvoicePort: QBOInvoicePort;
  auditLogRepo: AuditLogPort;
};

export async function pullInvoice(
  qboId: string,
  eventType: string,
  sourceEventId: string,
  deps: PullDeps
): Promise<void> {
  const { invoiceRepo, syncLinkRepo, qboInvoicePort, auditLogRepo } = deps;

  const syncLink = await syncLinkRepo.findByQboId(qboId);
  if (!syncLink) {
    // Invoice was created directly in QBO — no internal record exists yet.
    // Void/Delete events with no internal counterpart are a no-op.
    if (eventType === "Void" || eventType === "Delete") {
      logger.info({ qboId }, "pullInvoice: void/delete for unknown qboId, skipping");
      return;
    }
    const qboResult = await qboInvoicePort.getInvoice(qboId);
    const internalId = crypto.randomUUID();
    const now = new Date();
    await invoiceRepo.save({ ...qboResult.invoice, id: internalId, createdAt: now, updatedAt: now });
    await syncLinkRepo.upsertLinked(
      internalId,
      qboId,
      qboResult.qboSyncToken,
      qboResult.qboUpdatedAt,
      invoiceToSnapshot(qboResult.invoice),
      0
    );
    await auditLogRepo.create({
      syncLinkId: undefined,
      action: "invoice_created_from_qbo",
      sourceEventId,
      result: "SUCCESS",
      afterState: invoiceToSnapshot(qboResult.invoice),
    });
    logger.info({ qboId, internalId }, "pullInvoice: created internal invoice from QBO");
    return;
  }

  // Optimistic lock — set PROCESSING; version is incremented in DB on success
  const locked = await syncLinkRepo.setProcessing(syncLink.id, syncLink.version);
  if (!locked) return;

  // Track the version now held in DB after setProcessing incremented it
  const currentVersion = syncLink.version + 1;

  try {
    // Handle void/delete events without fetching from QBO.
    if (eventType === "Void" || eventType === "Delete") {
      const internalInvoice = await invoiceRepo.findById(syncLink.internalId);

      // Invoice missing internally — unexpected state (SyncLink exists but invoice doesn't).
      // Mark ERROR, not SYNCED: a missing invoice is not a successful void.
      if (!internalInvoice) {
        logger.warn(
          { qboId, internalId: syncLink.internalId },
          "pullInvoice: void event received but internal invoice not found"
        );
        await syncLinkRepo.setStatus(syncLink.id, currentVersion, "ERROR", {});
        await auditLogRepo.create({
          syncLinkId: syncLink.id,
          action: "void_internal_not_found",
          sourceEventId,
          result: "FAILURE",
          error: `Internal invoice ${syncLink.internalId} not found during void`,
        });
        return;
      }

      // Already voided — idempotent success
      if (internalInvoice.status === "void") {
        await syncLinkRepo.setStatus(syncLink.id, currentVersion, "SYNCED", {});
        await auditLogRepo.create({
          syncLinkId: syncLink.id,
          action: "skipped_already_voided",
          sourceEventId,
          result: "SUCCESS",
        });
        return;
      }

      // CRITICAL: write directly to repo — never through updateInvoice use-case
      await invoiceRepo.save({ ...internalInvoice, status: "void", updatedAt: new Date() });
      await syncLinkRepo.setStatus(syncLink.id, currentVersion, "SYNCED", {});
      await auditLogRepo.create({
        syncLinkId: syncLink.id,
        action: "invoice_voided_from_qbo",
        sourceEventId,
        result: "SUCCESS",
      });
      return;
    }

    // Refetch from QBO
    const qboResult = await qboInvoicePort.getInvoice(qboId);

    // Stale event check
    if (syncLink.qboUpdatedAt && qboResult.qboUpdatedAt <= syncLink.qboUpdatedAt) {
      await auditLogRepo.create({
        syncLinkId: syncLink.id, action: "skipped_stale", sourceEventId, result: "SUCCESS",
      });
      await syncLinkRepo.setStatus(syncLink.id, currentVersion, "SYNCED", {});
      return;
    }

    const internalInvoice = await invoiceRepo.findById(syncLink.internalId);
    if (!internalInvoice) {
      logger.warn({ internalId: syncLink.internalId }, "pullInvoice: internal invoice not found");
      await auditLogRepo.create({
        syncLinkId: syncLink.id,
        action: "internal_invoice_not_found",
        sourceEventId,
        result: "FAILURE",
        error: `Internal invoice ${syncLink.internalId} not found during update`,
      });
      await syncLinkRepo.setStatus(syncLink.id, currentVersion, "ERROR", {});
      return;
    }

    const snapshot = syncLink.lastSyncedSnapshot
      ? snapshotToInvoice(syncLink.lastSyncedSnapshot, internalInvoice)
      : internalInvoice;

    const conflictResult = detectConflicts(snapshot, internalInvoice, qboResult.invoice);

    if (conflictResult.hasConflict) {
      await syncLinkRepo.setStatus(syncLink.id, currentVersion, "CONFLICT", {});
      await auditLogRepo.create({
        syncLinkId: syncLink.id, action: "conflict_detected", sourceEventId, result: "FAILURE",
        beforeState: invoiceToSnapshot(internalInvoice),
        afterState: invoiceToSnapshot(qboResult.invoice),
      });
      return;
    }

    // CRITICAL: write directly to repo — never through createInvoice/updateInvoice use-cases
    await invoiceRepo.save({
      ...conflictResult.mergedInvoice,
      id: internalInvoice.id,
      createdAt: internalInvoice.createdAt,
      updatedAt: new Date(),
    });

    await syncLinkRepo.setStatus(syncLink.id, currentVersion, "SYNCED", {
      qboSyncToken: qboResult.qboSyncToken,
      qboUpdatedAt: qboResult.qboUpdatedAt,
      lastSyncedSnapshot: invoiceToSnapshot(conflictResult.mergedInvoice),
      lastSyncedAt: new Date(),
    });

    await auditLogRepo.create({
      syncLinkId: syncLink.id, action: "pull_applied", sourceEventId, result: "SUCCESS",
      afterState: invoiceToSnapshot(conflictResult.mergedInvoice),
    });
  } catch (err) {
    try {
      await syncLinkRepo.setStatus(syncLink.id, currentVersion, "ERROR", {});
    } catch {
      // Version conflict — a previous setStatus already succeeded.
      logger.warn({ qboId }, "pullInvoice: failed to set ERROR status (version conflict)");
    }
    throw err;
  }
}
