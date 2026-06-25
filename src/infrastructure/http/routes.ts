import type { FastifyInstance } from "fastify";
import { healthHandler } from "@/infrastructure/http/health/health.controller.js";

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", healthHandler);
}
