import type { FastifyInstance } from "fastify";
import { healthHandler } from "@/infrastructure/http/health/health.controller.js";
import { registerInvoiceRoutes } from "@/infrastructure/http/invoices/invoice.routes.js";
import { registerWebhookRoutes } from "@/infrastructure/http/webhooks/webhook.routes.js";

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", healthHandler);
  await registerInvoiceRoutes(app);
  await registerWebhookRoutes(app);
}
