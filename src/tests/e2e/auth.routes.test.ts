import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "@/app.js";

const mockCreds = vi.fn(async () => ({
  accessToken: "tok",
  refreshToken: "ref",
  expiresAt: new Date(Date.now() + 3600 * 1000),
  refreshTokenExpiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
}));

describe("Auth routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.doMock("@/infrastructure/database/qbo-credentials.repository.js", () => ({
      qboCredentialsRepository: { get: mockCreds },
    }));
    const { registerRoutes } = await import("@/infrastructure/http/routes.js");
    app = buildApp();
    await registerRoutes(app);
    await app.ready();
  });

  afterAll(async () => { await app.close(); });

  it("GET /auth/qbo/status returns 401 without API key", async () => {
    const res = await app.inject({ method: "GET", url: "/auth/qbo/status" });
    expect(res.statusCode).toBe(401);
  });

  it("GET /auth/qbo/status returns valid status with credentials", async () => {
    const res = await app.inject({
      method: "GET", url: "/auth/qbo/status",
      headers: { authorization: "Bearer test-api-key" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ valid: boolean; refreshTokenWarning: boolean }>();
    expect(body.valid).toBe(true);
    expect(body.refreshTokenWarning).toBe(false);
  });

  it("GET /auth/qbo/status sets refreshTokenWarning=true when <14 days remain", async () => {
    mockCreds.mockResolvedValueOnce({
      accessToken: "tok",
      refreshToken: "ref",
      expiresAt: new Date(Date.now() + 3600 * 1000),
      refreshTokenExpiresAt: new Date(Date.now() + 5 * 24 * 3600 * 1000), // 5 days
    });
    const res = await app.inject({
      method: "GET", url: "/auth/qbo/status",
      headers: { authorization: "Bearer test-api-key" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ refreshTokenWarning: boolean }>().refreshTokenWarning).toBe(true);
  });
});
