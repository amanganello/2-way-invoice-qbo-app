import { env } from "@/config/env.js";
import { buildApp } from "@/app.js";
import { registerRoutes } from "@/infrastructure/http/routes.js";
import { prisma } from "@/infrastructure/database/prisma.js";

const app = buildApp();

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

try {
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
} catch (err) {
  app.log.error({ err }, "Failed to start server");
  process.exit(1);
}
