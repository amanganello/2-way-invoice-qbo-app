import { Worker } from "bullmq";
import { redisConnection } from "@/infrastructure/queue/redis.js";
import { reconcileProcessor } from "./reconcile.processor.js";
import { pullProcessor } from "./pull.processor.js";
import { paymentProcessor } from "./payment.processor.js";
import { reconciliationProcessor } from "./reconciliation.processor.js";
import { startScheduler } from "./scheduler.js";
import { env } from "@/config/env.js";
import logger from "@/infrastructure/logger/index.js";

export function startWorkers(): { workers: Worker[]; stop: () => Promise<void> } {
  // Retry config (attempts + backoff) belongs on the Queue, not the Worker.
  // See src/infrastructure/queue/queues.ts for defaultJobOptions.
  const invoiceSyncWorker = new Worker("invoice-sync", async (job) => {
    if (job.name === "reconcile") return reconcileProcessor(job as Parameters<typeof reconcileProcessor>[0]);
    if (job.name === "pull") return pullProcessor(job as Parameters<typeof pullProcessor>[0]);
  }, {
    connection: redisConnection,
    concurrency: 5,
    limiter: { max: env.QBO_RATE_LIMIT_MAX, duration: 1000 },
  });

  const paymentSyncWorker = new Worker("payment-sync", async (job) => {
    return paymentProcessor(job as Parameters<typeof paymentProcessor>[0]);
  }, {
    connection: redisConnection,
    concurrency: 2,
  });

  const reconciliationWorker = new Worker("reconciliation", async () => {
    return reconciliationProcessor();
  }, {
    connection: redisConnection,
    concurrency: 1,
  });

  const workers = [invoiceSyncWorker, paymentSyncWorker, reconciliationWorker];

  for (const worker of workers) {
    worker.on("failed", (job, err) => {
      logger.error({ jobId: job?.id, jobName: job?.name, err }, "Job failed");
    });
    worker.on("completed", (job) => {
      logger.info({ jobId: job.id, jobName: job.name }, "Job completed");
    });
  }

  const scheduler = startScheduler();
  logger.info("Workers started");

  return {
    workers,
    stop: async () => {
      scheduler.stop();
      await Promise.all(workers.map(w => w.close()));
      logger.info("Workers stopped");
    },
  };
}
