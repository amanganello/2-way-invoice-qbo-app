import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "@/app.js";

// Mock intuit-oauth before any imports that use it
const mockAuthorizeUri = vi.fn(() => "https://appcenter.intuit.com/connect/oauth2?mock=1");
const mockCreateToken = vi.fn(async () => ({
  getJson: () => ({
    access_token: "new-access-token",
    refresh_token: "new-refresh-token",
    expires_in: 3600,
    x_refresh_token_expires_in: 8726400,
  }),
}));
vi.mock("intuit-oauth", () => ({
  default: Object.assign(
    vi.fn().mockImplementation(function () {
      return {
        authorizeUri: mockAuthorizeUri,
        createToken: mockCreateToken,
      };
    }),
    { scopes: { Accounting: "com.intuit.quickbooks.accounting" } }
  ),
}));

const mockCreds = vi.fn(async () => ({
  accessToken: "tok",
  refreshToken: "ref",
  expiresAt: new Date(Date.now() + 3600 * 1000),
  refreshTokenExpiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
}));
const mockSave = vi.fn(async () => undefined);

describe("Auth routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.doMock("@/infrastructure/database/qbo-credentials.repository.js", () => ({
      qboCredentialsRepository: { get: mockCreds, save: mockSave },
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
    const body = res.json<{ valid: boolean; refreshTokenExpiringSoon: boolean }>();
    expect(body.valid).toBe(true);
    expect(body.refreshTokenExpiringSoon).toBe(false);
  });

  it("GET /auth/qbo/status sets refreshTokenExpiringSoon=true when <14 days remain", async () => {
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
    expect(res.json<{ refreshTokenExpiringSoon: boolean }>().refreshTokenExpiringSoon).toBe(true);
  });

  it("GET /auth/qbo/status returns 401 with missing API key and no query param", async () => {
    const res = await app.inject({ method: "GET", url: "/auth/qbo/status" });
    expect(res.statusCode).toBe(401);
  });

  it("GET /auth/qbo/status accepts API key via ?apiKey= query param", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/auth/qbo/status?apiKey=test-api-key",
    });
    expect(res.statusCode).toBe(200);
  });

  it("GET /auth/qbo/start returns 401 without API key", async () => {
    const res = await app.inject({ method: "GET", url: "/auth/qbo/start" });
    expect(res.statusCode).toBe(401);
  });

  it("GET /auth/qbo/start redirects to QBO consent page with valid API key", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/auth/qbo/start?apiKey=test-api-key",
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers["location"]).toContain("appcenter.intuit.com");
  });

  it("GET /auth/qbo/callback with invalid state returns 400", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/auth/qbo/callback?code=abc&state=nonexistent-state&realmId=123",
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET /auth/qbo/callback with valid state saves tokens and redirects to ?auth=success", async () => {
    // Initiate flow to plant a valid state in pendingStates
    await app.inject({ method: "GET", url: "/auth/qbo/start?apiKey=test-api-key" });
    // The start handler calls client.authorizeUri({ scope, state }) — capture state from mock args
    const startCallArgs = mockAuthorizeUri.mock.calls.at(-1)?.[0] as { state: string };
    const state = startCallArgs.state;

    const res = await app.inject({
      method: "GET",
      url: `/auth/qbo/callback?code=valid-code&state=${state}&realmId=123`,
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers["location"]).toContain("auth=success");
    expect(mockSave).toHaveBeenCalledOnce();
  });
});
