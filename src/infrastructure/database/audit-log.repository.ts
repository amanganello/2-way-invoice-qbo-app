import { prisma } from "./prisma.js";
import type { AuditResult } from "@prisma/client";
import type { AuditLogPort, AuditLogRecord } from "@/application/ports/sync.ports.js";

export const auditLogRepository: AuditLogPort = {
  async create(data: {
    syncLinkId?: string;
    action: string;
    sourceEventId: string;
    beforeState?: Record<string, unknown>;
    afterState?: Record<string, unknown>;
    result: "SUCCESS" | "FAILURE";
    error?: string;
  }): Promise<void> {
    await prisma.auditLog.create({
      data: {
        ...(data.syncLinkId !== undefined ? { syncLinkId: data.syncLinkId } : {}),
        action: data.action,
        sourceEventId: data.sourceEventId,
        beforeState: data.beforeState ? JSON.parse(JSON.stringify(data.beforeState)) : undefined,
        afterState: data.afterState ? JSON.parse(JSON.stringify(data.afterState)) : undefined,
        result: data.result as AuditResult,
        error: data.error,
      },
    });
  },

  async findBySyncLinkId(syncLinkId: string): Promise<AuditLogRecord[]> {
    return prisma.auditLog.findMany({
      where: { syncLinkId },
      orderBy: { createdAt: "desc" },
    }) as Promise<AuditLogRecord[]>;
  },
};

export type AuditLogRepository = typeof auditLogRepository;
