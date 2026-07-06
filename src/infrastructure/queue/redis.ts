import { Redis } from "ioredis";
import { env } from "@/config/env.js";
import logger from "@/infrastructure/logger/index.js";

export const redisConnection = new Redis(env.REDIS_URL, {
  password: env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

// Shared across 3 Queues, 3 Workers, and direct app usage (auth state, health check).
// BullMQ adds ~2 "end" listeners per Queue/Worker — 30 is a safe ceiling for this topology.
redisConnection.setMaxListeners(30);

redisConnection.on("error", err => {
  logger.error({ err }, "Redis connection error");
});
