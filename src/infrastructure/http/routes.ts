import type { FastifyInstance } from "fastify";
import { healthHandler } from "@/infrastructure/http/health/health.controller.js";
import { registerInvoiceRoutes } from "@/infrastructure/http/invoices/invoice.routes.js";
import { registerWebhookRoutes } from "@/infrastructure/http/webhooks/webhook.routes.js";
import { registerAuthRoutes } from "@/infrastructure/http/auth/auth.routes.js";
import { registerSyncRoutes } from "@/infrastructure/http/sync/sync.routes.js";
import { apiKeyMiddleware } from "@/infrastructure/http/middleware/api-key.js";
import type { AuthRouteDeps } from "./auth/auth.routes.js";
import type { InvoiceRouteDeps } from "./invoices/invoice.routes.js";

export type RouteDeps = {
  auth?: AuthRouteDeps;
  invoices?: InvoiceRouteDeps;
};

export async function registerRoutes(app: FastifyInstance, deps: RouteDeps = {}): Promise<void> {
  // Routes exempt from API key auth — register before the hook
  app.get("/health", healthHandler);
  await registerWebhookRoutes(app);
  await registerAuthRoutes(app, deps.auth); // registers /auth/qbo/callback (exempt) AND /auth/qbo/start + /auth/qbo/status (protected)

  // All routes registered after this hook require a valid API key.
  app.addHook("onRequest", apiKeyMiddleware);
  await registerInvoiceRoutes(app, deps.invoices);
  await registerSyncRoutes(app);
}
