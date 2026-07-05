import type { FastifyInstance } from "fastify";
import { healthHandler } from "@/infrastructure/http/health/health.controller.js";
import { registerInvoiceRoutes } from "@/infrastructure/http/invoices/invoice.routes.js";
import { registerWebhookRoutes } from "@/infrastructure/http/webhooks/webhook.routes.js";
import { registerAuthRoutes } from "@/infrastructure/http/auth/auth.routes.js";
import { registerSyncRoutes } from "@/infrastructure/http/sync/sync.routes.js";
import { apiKeyMiddleware } from "@/infrastructure/http/middleware/api-key.js";

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  // Routes exempt from API key auth — register before the hook
  app.get("/health", healthHandler);
  await registerWebhookRoutes(app);
  await registerAuthRoutes(app); // registers /auth/qbo/callback (exempt) AND /auth/qbo/start + /auth/qbo/status (protected)

  // All routes registered after this hook require a valid API key.
  app.addHook("onRequest", apiKeyMiddleware);
  await registerInvoiceRoutes(app);
  await registerSyncRoutes(app);
}
