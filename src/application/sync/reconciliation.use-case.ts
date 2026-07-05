import type { SyncLinkRepository } from "@/infrastructure/database/sync-link.repository.js";
import logger from "@/infrastructure/logger/index.js";

export type ReconciliationDeps = {
  syncLinkRepo: Pick<SyncLinkRepository, "findStuckProcessing" | "findByStatuses" | "findUnsynced" | "findInvoicesWithoutSyncLink" | "setStatus">;
  enqueueReconcile: (internalId: string) => Promise<void>;
};

export async function runReconciliation(deps: ReconciliationDeps): Promise<void> {
  const { syncLinkRepo, enqueueReconcile } = deps;

  // Watchdog: reset stuck PROCESSING records (crashed workers)
  const stuck = await syncLinkRepo.findStuckProcessing(10);
  for (const link of stuck) {
    logger.warn(
      { syncLinkId: link.id, internalId: link.internalId },
      "Resetting stuck PROCESSING record to ERROR"
    );
    await syncLinkRepo.setStatus(link.id, link.version, "ERROR", {});
  }

  // Scan PENDING | ERROR (excluding PROCESSING and CONFLICT)
  const toRetry = await syncLinkRepo.findByStatuses(["PENDING", "ERROR"]);
  // SyncLinks that exist but have never synced
  const unsynced = await syncLinkRepo.findUnsynced();
  // Invoices with no SyncLink at all (job lost before worker could create one)
  const orphaned = await syncLinkRepo.findInvoicesWithoutSyncLink();

  const seen = new Set<string>();
  const all = [...toRetry, ...unsynced, ...orphaned];

  for (const link of all) {
    if (seen.has(link.internalId)) continue;
    seen.add(link.internalId);
    // BullMQ jobId deduplication: if job already waiting/active, this is silently dropped
    await enqueueReconcile(link.internalId);
  }

  logger.info(
    { watchdogReset: stuck.length, enqueued: seen.size },
    "Reconciliation cycle complete"
  );
}
