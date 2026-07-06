import { env } from "@/config/env.js";
import { buildApp } from "@/app.js";
import { registerRoutes } from "@/infrastructure/http/routes.js";
import { prisma } from "@/infrastructure/database/prisma.js";
import { redisConnection } from "@/infrastructure/queue/redis.js";
import { startWorkers } from "@/infrastructure/worker/index.js";
import fastifyStatic from '@fastify/static'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

const app = buildApp();
const workerRuntime = env.RUN_WORKERS_IN_WEB ? startWorkers() : undefined;

if (workerRuntime) {
  app.log.warn("RUN_WORKERS_IN_WEB enabled: workers are running inside the web process");
}

await app.register(fastifyStatic, {
  root: join(__dirname, '..', 'client', 'dist'),
  prefix: '/',
})
// Serve index.html for the root route
app.get('/', async (_req, reply) => {
  return reply.sendFile('index.html')
})

await registerRoutes(app);

const shutdown = async (signal: string): Promise<void> => {
  app.log.info(`Received ${signal}, shutting down gracefully`);
  try {
    await app.close();
    await workerRuntime?.stop();
    await prisma.$disconnect();
    await redisConnection.quit();
    app.log.info("Server closed");
    process.exit(0);
  } catch (err) {
    app.log.error({ err }, "Error during shutdown");
    await workerRuntime?.stop().catch(() => {});
    await prisma.$disconnect().catch(() => {});
    await redisConnection.quit().catch(() => {});
    process.exit(1);
  }
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

process.on("unhandledRejection", (reason) => {
  const logContext = {
    err: reason,
    reason:
      reason instanceof Error
        ? {
            name: reason.name,
            message: reason.message,
            stack: reason.stack,
          }
        : reason,
  };

  if (env.RUN_WORKERS_IN_WEB) {
    app.log.error(logContext, "Unhandled promise rejection; keeping web process alive for demo worker mode");
  } else {
    app.log.fatal(logContext, "Unhandled promise rejection");
    process.exit(1);
  }
});

try {
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
} catch (err) {
  app.log.error({ err }, "Failed to start server");
  process.exit(1);
}
