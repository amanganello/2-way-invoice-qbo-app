import cron from "node-cron";
import { reconciliationQueue } from "@/infrastructure/queue/queues.js";
import { env } from "@/config/env.js";
import logger from "@/infrastructure/logger/index.js";

export function startScheduler(): void {
  const intervalMinutes = env.RECONCILIATION_INTERVAL_MINUTES;
  const cronExpression = `*/${intervalMinutes} * * * *`;

  cron.schedule(cronExpression, async () => {
    logger.info("Scheduler: triggering reconciliation job");
    await reconciliationQueue.add("reconciliation", {}, { jobId: "reconciliation" });
  });

  logger.info({ intervalMinutes }, "Scheduler started");
}
