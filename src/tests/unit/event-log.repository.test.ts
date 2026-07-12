import { describe, it, expect, vi, type Mock } from "vitest";

// We test the repository logic by mocking prisma at module level.
// This verifies the right Prisma calls are made with the right args.
vi.mock("@/infrastructure/database/prisma.js", () => ({
  prisma: {
    eventLog: {
      createMany: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

import { prisma } from "@/infrastructure/database/prisma.js";
import { PrismaEventLogRepository } from "@/infrastructure/database/event-log.repository.js";

const repo = new PrismaEventLogRepository();

describe("PrismaEventLogRepository", () => {
  it("createIfNotExists returns created=true when row is new", async () => {
    (prisma.eventLog.createMany as Mock).mockResolvedValue({ count: 1 });

    const result = await repo.createIfNotExists({
      eventId: "ev-1",
      source: "QBO",
      eventType: "Update",
      payload: { id: "1" },
    });

    expect(result.created).toBe(true);
    expect(result.status).toBeNull();
  });

  it("createIfNotExists returns created=false and existing status when duplicate", async () => {
    (prisma.eventLog.createMany as Mock).mockResolvedValue({ count: 0 });
    (prisma.eventLog.findUnique as Mock).mockResolvedValue({ status: "PROCESSED" });

    const result = await repo.createIfNotExists({
      eventId: "ev-1",
      source: "QBO",
      eventType: "Update",
      payload: {},
    });

    expect(result.created).toBe(false);
    expect(result.status).toBe("PROCESSED");
  });

  it("markProcessed calls updateMany with PROCESSED status", async () => {
    (prisma.eventLog.updateMany as Mock).mockResolvedValue({ count: 1 });
    await repo.markProcessed("ev-1");
    expect(prisma.eventLog.updateMany).toHaveBeenCalledWith({
      where: { eventId: "ev-1" },
      data: { status: "PROCESSED", processedAt: expect.any(Date) },
    });
  });

  it("markFailed calls updateMany with FAILED status", async () => {
    (prisma.eventLog.updateMany as Mock).mockResolvedValue({ count: 1 });
    await repo.markFailed("ev-1");
    expect(prisma.eventLog.updateMany).toHaveBeenCalledWith({
      where: { eventId: "ev-1" },
      data: { status: "FAILED" },
    });
  });

  it("resetToPending calls updateMany with PENDING status", async () => {
    (prisma.eventLog.updateMany as Mock).mockResolvedValue({ count: 1 });
    await repo.resetToPending("ev-1");
    expect(prisma.eventLog.updateMany).toHaveBeenCalledWith({
      where: { eventId: "ev-1" },
      data: { status: "PENDING", processedAt: null },
    });
  });
});
