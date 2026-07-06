import cron from "node-cron";
import { reconciliationQueue } from "@/infrastructure/queue/queues.js";
import { env } from "@/config/env.js";
import logger from "@/infrastructure/logger/index.js";

export function startScheduler(): { stop: () => void } {
  const intervalMinutes = env.RECONCILIATION_INTERVAL_MINUTES;
  const cronExpression = `*/${intervalMinutes} * * * *`;

  const task = cron.schedule(cronExpression, async () => {
    logger.info("Scheduler: triggering reconciliation job");
    try {
      await reconciliationQueue.add("reconciliation", {}, { jobId: "reconciliation" });
    } catch (err) {
      logger.error({ err }, "Scheduler: failed to enqueue reconciliation job");
    }
  });

  logger.info({ intervalMinutes }, "Scheduler started");

  return { stop: () => task.stop() };
}
