import { Queue } from "bullmq";
import { redisConnection } from "./redis.js";
import { env } from "@/config/env.js";
import type { SyncQueuePort } from "@/application/ports/invoice.ports.js";

const defaultJobOptions = {
  attempts: env.SYNC_JOB_MAX_RETRIES,
  backoff: { type: "exponential" as const, delay: 5000 },
  removeOnComplete: true,
  removeOnFail: true,
};

export const invoiceSyncQueue = new Queue("invoice-sync", {
  connection: redisConnection,
  defaultJobOptions,
});

export const paymentSyncQueue = new Queue("payment-sync", {
  connection: redisConnection,
  defaultJobOptions: { ...defaultJobOptions, removeOnFail: { count: 100 } },
});

export const reconciliationQueue = new Queue("reconciliation", {
  connection: redisConnection,
  defaultJobOptions,
});

export class BullMQSyncQueue implements SyncQueuePort {
  async enqueueReconcile(internalId: string): Promise<void> {
    await invoiceSyncQueue.add(
      "reconcile",
      { internalId },
      { jobId: `reconcile-${internalId}` }
    );
  }

  async enqueuePaymentSync(internalPaymentId: string): Promise<void> {
    await paymentSyncQueue.add(
      "push-payment",
      { internalPaymentId },
      { jobId: `payment-${internalPaymentId}` }
    );
  }
}

export const syncQueue = new BullMQSyncQueue();
