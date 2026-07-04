import { env } from "@/config/env.js";
import { buildApp } from "@/app.js";
import { registerRoutes } from "@/infrastructure/http/routes.js";
import { prisma } from "@/infrastructure/database/prisma.js";
import fastifyStatic from '@fastify/static'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

const app = buildApp();

await app.register(fastifyStatic, {
  root: join(__dirname, '..', 'client', 'dist'),
  prefix: '/',
  decorateReply: false,
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
    await prisma.$disconnect();
    app.log.info("Server closed");
    process.exit(0);
  } catch (err) {
    app.log.error({ err }, "Error during shutdown");
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  }
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

process.on("unhandledRejection", (reason) => {
  app.log.fatal({ err: reason }, "Unhandled promise rejection");
  process.exit(1);
});

try {
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
} catch (err) {
  app.log.error({ err }, "Failed to start server");
  process.exit(1);
}
