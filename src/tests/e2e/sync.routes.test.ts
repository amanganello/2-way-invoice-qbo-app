import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "@/app.js";

const AUTH = { authorization: "Bearer test-api-key" };

const mockSyncLink = {
  id: "sl-1", internalId: "inv-1", qboId: "qbo-1", syncStatus: "CONFLICT",
  version: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  qboSyncToken: null, qboUpdatedAt: null, lastSyncedAt: null, lastSyncedSnapshot: null, internalUpdatedAt: new Date().toISOString(),
};

const mockPrisma = {
  syncLink: {
    findMany: vi.fn(async () => [mockSyncLink]),
    findUnique: vi.fn(async () => mockSyncLink),
  },
  invoice: { findMany: vi.fn(async () => []) },
};

const mockSyncLinkRepo = {
  findByInternalId: vi.fn(async () => null),
  findById: vi.fn(async () => mockSyncLink),
  list: vi.fn(async () => [mockSyncLink]),
  listConflicts: vi.fn(async () => [mockSyncLink]),
  findInvoicesWithoutSyncLink: vi.fn(async () => []),
  create: vi.fn(async () => mockSyncLink),
  setStatus: vi.fn(async () => mockSyncLink),
};

const mockInvoiceSyncQueue = { add: vi.fn(async () => ({ id: "job-1" })) };
const mockSyncQueue = { enqueueReconcile: vi.fn(async () => {}) };
const mockAuditLogRepo = { findBySyncLinkId: vi.fn(async () => []) };

describe("Sync routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.doMock("@/infrastructure/database/prisma", () => ({ prisma: mockPrisma }));
    vi.doMock("@/infrastructure/database/sync-link.repository", () => ({ syncLinkRepository: mockSyncLinkRepo }));
    vi.doMock("@/infrastructure/database/audit-log.repository", () => ({ auditLogRepository: mockAuditLogRepo }));
    vi.doMock("@/infrastructure/queue/queues", () => ({ invoiceSyncQueue: mockInvoiceSyncQueue, syncQueue: mockSyncQueue }));
    vi.doMock("@/infrastructure/queue/redis", () => ({ redisConnection: { ping: vi.fn(async () => "PONG") } }));

    const { registerRoutes } = await import("@/infrastructure/http/routes.js");
    app = buildApp();
    await registerRoutes(app);
    await app.ready();
  });

  afterAll(async () => { await app.close(); });

  it("GET /sync/links returns 401 without API key", async () => {
    const res = await app.inject({ method: "GET", url: "/sync/links" });
    expect(res.statusCode).toBe(401);
  });

  it("GET /sync/links returns list", async () => {
    const res = await app.inject({ method: "GET", url: "/sync/links", headers: AUTH });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it("GET /sync/links/:id returns SyncLink with auditLogs", async () => {
    const res = await app.inject({ method: "GET", url: "/sync/links/sl-1", headers: AUTH });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ id: string; auditLogs: unknown[] }>();
    expect(body.id).toBe("sl-1");
    expect(Array.isArray(body.auditLogs)).toBe(true);
  });

  it("GET /sync/conflicts returns 200", async () => {
    const res = await app.inject({ method: "GET", url: "/sync/conflicts", headers: AUTH });
    expect(res.statusCode).toBe(200);
  });

  it("POST /sync/conflicts/:id/resolve accept-internal re-enqueues reconcile", async () => {
    mockSyncQueue.enqueueReconcile.mockClear();
    mockSyncLinkRepo.setStatus.mockClear();
    const res = await app.inject({
      method: "POST", url: "/sync/conflicts/sl-1/resolve",
      headers: { ...AUTH, "content-type": "application/json" },
      payload: JSON.stringify({ strategy: "accept-internal" }),
    });
    expect(res.statusCode).toBe(200);
    expect(mockSyncLinkRepo.setStatus).toHaveBeenCalledWith("sl-1", 0, "PENDING", {});
    expect(mockSyncQueue.enqueueReconcile).toHaveBeenCalledWith("inv-1");
  });

  it("POST /sync/conflicts/:id/resolve accept-qbo sets SYNCED and skips enqueue", async () => {
    mockSyncQueue.enqueueReconcile.mockClear();
    mockSyncLinkRepo.setStatus.mockClear();
    const res = await app.inject({
      method: "POST", url: "/sync/conflicts/sl-1/resolve",
      headers: { ...AUTH, "content-type": "application/json" },
      payload: JSON.stringify({ strategy: "accept-qbo" }),
    });
    expect(res.statusCode).toBe(200);
    expect(mockSyncLinkRepo.setStatus).toHaveBeenCalledWith("sl-1", 0, "SYNCED", {});
    expect(mockSyncQueue.enqueueReconcile).not.toHaveBeenCalled();
  });

  it("POST /sync/initial-load/qbo-to-internal returns 501", async () => {
    const res = await app.inject({ method: "POST", url: "/sync/initial-load/qbo-to-internal", headers: AUTH });
    expect(res.statusCode).toBe(501);
  });

  it("POST /sync/initial-load/internal-to-qbo returns enqueued count", async () => {
    const res = await app.inject({ method: "POST", url: "/sync/initial-load/internal-to-qbo", headers: AUTH });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ enqueued: number; skipped: number }>();
    expect(typeof body.enqueued).toBe("number");
  });
});
