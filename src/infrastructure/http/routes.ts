import type { FastifyInstance } from "fastify";
import { healthHandler } from "@/infrastructure/http/health/health.controller.js";
import { registerInvoiceRoutes } from "@/infrastructure/http/invoices/invoice.routes.js";
import { registerWebhookRoutes } from "@/infrastructure/http/webhooks/webhook.routes.js";
import { registerAuthRoutes } from "@/infrastructure/http/auth/auth.routes.js";
import { registerSyncRoutes } from "@/infrastructure/http/sync/sync.routes.js";
import { apiKeyMiddleware } from "@/infrastructure/http/middleware/api-key.js";

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", healthHandler);
  await registerInvoiceRoutes(app);
  await registerWebhookRoutes(app);

  // All routes registered after this hook require a valid API key.
  // /health and /webhooks/qbo are excluded in the middleware itself.
  app.addHook("onRequest", apiKeyMiddleware);
  await registerAuthRoutes(app);
  await registerSyncRoutes(app);
}
