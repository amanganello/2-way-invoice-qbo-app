import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { createHmac } from "node:crypto";
import { buildApp } from "@/app";

const VERIFIER_TOKEN = "test-webhook-token"; // matches vitest.config.ts QB_WEBHOOK_VERIFIER_TOKEN

function makeSignature(body: string): string {
  return createHmac("sha256", VERIFIER_TOKEN).update(body).digest("base64");
}

const mockQueue = { add: vi.fn(async () => ({ id: "job-1" })) };
const mockPrisma = {
  eventLog: {
    createMany: vi.fn(async ({ data }: { data: unknown[] }) => ({ count: data.length })),
  },
};

describe("POST /webhooks/qbo", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.doMock("@/infrastructure/queue/queues", () => ({ invoiceSyncQueue: mockQueue }));
    vi.doMock("@/infrastructure/database/prisma", () => ({ prisma: mockPrisma }));
    vi.doMock("@/infrastructure/queue/redis", () => ({
      redisConnection: { ping: vi.fn(async () => "PONG") },
    }));

    const { registerRoutes } = await import("@/infrastructure/http/routes");
    app = buildApp();
    await registerRoutes(app);
    await app.ready();
  });

  afterAll(async () => { await app.close(); });

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
    const sig = makeSignature(payload);
    const res = await app.inject({
      method: "POST", url: "/webhooks/qbo", payload,
      headers: { "intuit-signature-hash": sig, "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(200);
    expect(mockQueue.add).toHaveBeenCalledWith(
      "pull",
      expect.objectContaining({ qboId: "qbo-123", entityType: "Invoice" }),
      expect.objectContaining({ jobId: "pull-Invoice-qbo-123" })
    );
  });

  it("returns 200 when EventLog insert finds duplicate (count=0), after enqueuing", async () => {
    mockQueue.add.mockClear();
    mockPrisma.eventLog.createMany.mockResolvedValue({ count: 0 });
    const sig = makeSignature(payload);
    const res = await app.inject({
      method: "POST", url: "/webhooks/qbo", payload,
      headers: { "intuit-signature-hash": sig, "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(200);
    // Job is enqueued BEFORE checking for duplicates; BullMQ jobId dedup prevents actual duplication
    expect(mockQueue.add).toHaveBeenCalledWith(
      "pull",
      expect.objectContaining({ qboId: "qbo-123", entityType: "Invoice" }),
      expect.objectContaining({ jobId: "pull-Invoice-qbo-123" })
    );
  });

  it("returns 503 and does NOT commit EventLog when enqueue fails", async () => {
    mockPrisma.eventLog.createMany.mockClear();
    mockQueue.add.mockRejectedValueOnce(new Error("Redis unavailable"));
    const sig = makeSignature(payload);
    const res = await app.inject({
      method: "POST", url: "/webhooks/qbo", payload,
      headers: { "intuit-signature-hash": sig, "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(503);
    expect(mockPrisma.eventLog.createMany).not.toHaveBeenCalled();
  });
});
