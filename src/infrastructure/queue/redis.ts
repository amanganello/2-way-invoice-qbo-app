import { Redis } from "ioredis";
import { env } from "@/config/env.js";

export const redisConnection = new Redis(env.REDIS_URL, {
  password: env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});
