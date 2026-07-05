import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "@/app";
import { registerRoutes } from "@/infrastructure/http/routes";
import type { FastifyInstance } from "fastify";

describe("GET /health", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp();
    await registerRoutes(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns 200 with status ok and a valid ISO timestamp", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);

    const body = response.json<{ status: string; timestamp: string }>();
    expect(body.status).toBe("ok");
    expect(typeof body.timestamp).toBe("string");
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
  });
});
