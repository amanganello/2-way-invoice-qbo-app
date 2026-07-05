import { runReconciliation } from "@/application/sync/reconciliation.use-case.js";
import { syncLinkRepository } from "@/infrastructure/database/sync-link.repository.js";
import { invoiceSyncQueue, paymentSyncQueue } from "@/infrastructure/queue/queues.js";
import { env } from "@/config/env.js";
import logger from "@/infrastructure/logger/index.js";

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
    enqueueFailedPaymentRetries: async () => {
      const failedJobs = await paymentSyncQueue.getFailed(0, 100);
      for (const job of failedJobs) {
        const { internalPaymentId } = job.data as { internalPaymentId: string };
        logger.warn({ internalPaymentId, jobId: job.id }, "Retrying failed payment sync job");
        await job.remove();
        await paymentSyncQueue.add(
          "push-payment",
          { internalPaymentId },
          {
            jobId: `payment-${internalPaymentId}`,
            attempts: env.SYNC_JOB_MAX_RETRIES,
            backoff: { type: "exponential" as const, delay: 5000 },
          }
        );
      }
    },
  });
}
