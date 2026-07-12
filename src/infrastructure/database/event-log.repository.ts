import { EventSource } from "@prisma/client";
import { prisma } from "./prisma.js";
import type { EventLogPort, EventLogStatus } from "@/application/ports/event-log.port.js";

export class PrismaEventLogRepository implements EventLogPort {
  async createIfNotExists(data: {
    eventId: string;
    source: string;
    eventType: string;
    payload: object;
  }): Promise<{ created: boolean; status: EventLogStatus | null }> {
    const result = await prisma.eventLog.createMany({
      data: [{ ...data, source: data.source as EventSource }],
      skipDuplicates: true,
    });

    if (result.count > 0) return { created: true, status: null };

    const existing = await prisma.eventLog.findUnique({ where: { eventId: data.eventId } });
    return { created: false, status: (existing?.status as EventLogStatus) ?? null };
  }

  async findStatus(eventId: string): Promise<EventLogStatus | null> {
    const row = await prisma.eventLog.findUnique({ where: { eventId } });
    return (row?.status as EventLogStatus) ?? null;
  }

  async markProcessed(eventId: string): Promise<void> {
    await prisma.eventLog.updateMany({
      where: { eventId },
      data: { status: "PROCESSED", processedAt: new Date() },
    });
  }

  async markFailed(eventId: string): Promise<void> {
    await prisma.eventLog.updateMany({
      where: { eventId },
      data: { status: "FAILED" },
    });
  }

  async resetToPending(eventId: string): Promise<void> {
    await prisma.eventLog.updateMany({
      where: { eventId },
      data: { status: "PENDING", processedAt: null },
    });
  }
}

export const eventLogRepository = new PrismaEventLogRepository();
