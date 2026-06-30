import { startWorkers } from "@/infrastructure/worker/index.js";
import { prisma } from "@/infrastructure/database/prisma.js";
import { redisConnection } from "@/infrastructure/queue/redis.js";
import logger from "@/infrastructure/logger/index.js";

const { stop } = startWorkers();

const shutdown = async (signal: string): Promise<void> => {
  logger.info(`Worker received ${signal}, shutting down`);
  await stop();
  await prisma.$disconnect();
  await redisConnection.quit();
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
