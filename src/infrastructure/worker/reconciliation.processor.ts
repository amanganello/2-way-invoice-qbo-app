import { runReconciliation } from "@/application/sync/reconciliation.use-case.js";
import { syncLinkRepository } from "@/infrastructure/database/sync-link.repository.js";
import { invoiceSyncQueue } from "@/infrastructure/queue/queues.js";

export async function reconciliationProcessor(): Promise<void> {
  await runReconciliation({
    syncLinkRepo: syncLinkRepository,
    enqueueReconcile: async (internalId) => {
      await invoiceSyncQueue.add(
        "reconcile",
        { internalId },
        { jobId: `reconcile-${internalId}` }
      );
    },
  });
}
