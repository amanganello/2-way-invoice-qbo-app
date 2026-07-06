import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { createHmac } from "node:crypto";
import { buildApp } from "@/app.js";

const VERIFIER_TOKEN = "test-webhook-token"; // matches vitest.config.ts QB_WEBHOOK_VERIFIER_TOKEN

function makeSignature(body: string): string {
  return createHmac("sha256", VERIFIER_TOKEN).update(body).digest("base64");
}

const mockQueue = { add: vi.fn(async () => ({ id: "job-1" })) };
const mockSyncQueue = { enqueueReconcile: vi.fn(async () => {}) };
type MockEventLogRow = { eventId: string; status: string };
const mockPrisma = {
  eventLog: {
    createMany: vi.fn(async ({ data }: { data: unknown[] }) => ({ count: data.length })),
    findUnique: vi.fn(async (): Promise<MockEventLogRow | null> => null),
    update: vi.fn(async () => ({})),
    updateMany: vi.fn(async () => ({ count: 1 })),
  },
};

describe("POST /webhooks/qbo", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.doMock("@/infrastructure/queue/queues", () => ({ invoiceSyncQueue: mockQueue, syncQueue: mockSyncQueue }));
    vi.doMock("@/infrastructure/database/prisma", () => ({ prisma: mockPrisma }));
    vi.doMock("@/infrastructure/queue/redis", () => ({
      redisConnection: { ping: vi.fn(async () => "PONG") },
    }));

    const { registerRoutes } = await import("@/infrastructure/http/routes.js");
    app = buildApp();
    await registerRoutes(app);
    await app.ready();
  });

  afterAll(async () => { await app.close(); });

  beforeEach(() => {
    mockQueue.add.mockResolvedValue({ id: "job-1" });
    mockPrisma.eventLog.createMany.mockImplementation(async ({ data }: { data: unknown[] }) => ({ count: data.length }));
    mockPrisma.eventLog.findUnique.mockResolvedValue(null);
    mockPrisma.eventLog.update.mockResolvedValue({});
    mockPrisma.eventLog.updateMany.mockResolvedValue({ count: 1 });
    vi.clearAllMocks();
  });

  const payload = JSON.stringify({
    eventNotifications: [{ realmId: "test", dataChangeEvent: {
      entities: [{ name: "Invoice", id: "qbo-123", operation: "Update", lastUpdated: "2026-01-01" }],
    }}],
  });

  it("returns 401 when signature is missing", async () => {
    const res = await app.inject({ method: "POST", url: "/webhooks/qbo", payload });
    expect(res.statusCode).toBe(401);
  });

  it("returns 401 when signature is wrong", async () => {
    const res = await app.inject({
      method: "POST", url: "/webhooks/qbo", payload,
      headers: { "intuit-signature-hash": "badsignature" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 200 and enqueues pull job when signature is valid", async () => {
    mockQueue.add.mockClear();
    mockPrisma.eventLog.createMany.mockResolvedValue({ count: 1 });
    mockPrisma.eventLog.findUnique.mockResolvedValue(null);
    const sig = makeSignature(payload);
    const res = await app.inject({
      method: "POST", url: "/webhooks/qbo", payload,
      headers: { "intuit-signature-hash": sig, "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(200);
    expect(mockQueue.add).toHaveBeenCalledWith(
      "pull",
      expect.objectContaining({ qboId: "qbo-123", entityType: "Invoice" }),
      expect.objectContaining({ jobId: "pull-Invoice-qbo-123-2026-01-01" })
    );
  });

  it("returns 200 and skips enqueue when EventLog insert finds non-failed duplicate", async () => {
    mockQueue.add.mockClear();
    mockPrisma.eventLog.createMany.mockResolvedValue({ count: 0 });
    mockPrisma.eventLog.findUnique.mockResolvedValue({ eventId: "Invoice-qbo-123-2026-01-01", status: "PROCESSED" });
    const sig = makeSignature(payload);
    const res = await app.inject({
      method: "POST", url: "/webhooks/qbo", payload,
      headers: { "intuit-signature-hash": sig, "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(200);
    expect(mockQueue.add).not.toHaveBeenCalled();
  });

  it("re-enqueues pending duplicate EventLog without resetting status", async () => {
    mockQueue.add.mockClear();
    mockPrisma.eventLog.createMany.mockResolvedValue({ count: 0 });
    mockPrisma.eventLog.findUnique.mockResolvedValue({ eventId: "Invoice-qbo-123-2026-01-01", status: "PENDING" });
    const sig = makeSignature(payload);
    const res = await app.inject({
      method: "POST", url: "/webhooks/qbo", payload,
      headers: { "intuit-signature-hash": sig, "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(200);
    expect(mockPrisma.eventLog.updateMany).not.toHaveBeenCalled();
    expect(mockQueue.add).toHaveBeenCalledWith(
      "pull",
      expect.objectContaining({ qboId: "qbo-123", entityType: "Invoice" }),
      expect.objectContaining({ jobId: "pull-Invoice-qbo-123-2026-01-01" })
    );
  });

  it("resets failed duplicate EventLog before re-enqueueing", async () => {
    mockQueue.add.mockClear();
    mockPrisma.eventLog.createMany.mockResolvedValue({ count: 0 });
    mockPrisma.eventLog.findUnique.mockResolvedValue({ eventId: "Invoice-qbo-123-2026-01-01", status: "FAILED" });
    const sig = makeSignature(payload);
    const res = await app.inject({
      method: "POST", url: "/webhooks/qbo", payload,
      headers: { "intuit-signature-hash": sig, "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(200);
    expect(mockPrisma.eventLog.updateMany).toHaveBeenCalledWith({
      where: { eventId: "Invoice-qbo-123-2026-01-01" },
      data: { status: "PENDING", processedAt: null },
    });
    expect(mockQueue.add).toHaveBeenCalledWith(
      "pull",
      expect.objectContaining({ qboId: "qbo-123", entityType: "Invoice" }),
      expect.objectContaining({ jobId: "pull-Invoice-qbo-123-2026-01-01" })
    );
  });

  it("returns 503 and marks EventLog FAILED when enqueue fails", async () => {
    mockPrisma.eventLog.createMany.mockClear();
    mockPrisma.eventLog.createMany.mockResolvedValue({ count: 1 });
    mockPrisma.eventLog.updateMany.mockClear();
    mockQueue.add.mockRejectedValueOnce(new Error("Redis unavailable"));
    const sig = makeSignature(payload);
    const res = await app.inject({
      method: "POST", url: "/webhooks/qbo", payload,
      headers: { "intuit-signature-hash": sig, "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(503);
    expect(mockPrisma.eventLog.createMany).toHaveBeenCalledOnce();
    expect(mockPrisma.eventLog.updateMany).toHaveBeenCalledWith({
      where: { eventId: "Invoice-qbo-123-2026-01-01" },
      data: { status: "FAILED" },
    });
  });
});
