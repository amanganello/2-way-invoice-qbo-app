import type { SyncLinkPort } from "@/application/ports/sync.ports.js";
import logger from "@/infrastructure/logger/index.js";

export type SyncRecoveryScanDeps = {
  syncLinkRepo: Pick<SyncLinkPort, "findStuckProcessing" | "findByStatuses" | "findUnsynced" | "findInvoicesWithoutSyncLink" | "setStatus">;
  enqueueReconcile: (internalId: string) => Promise<void>;
  enqueueFailedPaymentRetries?: () => Promise<void>;
};

export async function runSyncRecoveryScan(deps: SyncRecoveryScanDeps): Promise<void> {
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

  if (deps.enqueueFailedPaymentRetries) {
    await deps.enqueueFailedPaymentRetries();
  }

  logger.info(
    { watchdogReset: stuck.length, enqueued: seen.size },
    "Recovery scan cycle complete"
  );
}
