import { prisma } from "./prisma.js";
import type { AuditResult } from "@prisma/client";

export type AuditLogRecord = {
  id: string;
  syncLinkId: string;
  action: string;
  sourceEventId: string;
  beforeState: Record<string, unknown> | null;
  afterState: Record<string, unknown> | null;
  result: "SUCCESS" | "FAILURE";
  error: string | null;
  createdAt: Date;
};

export const auditLogRepository = {
  async create(data: {
    syncLinkId: string;
    action: string;
    sourceEventId: string;
    beforeState?: Record<string, unknown>;
    afterState?: Record<string, unknown>;
    result: "SUCCESS" | "FAILURE";
    error?: string;
  }): Promise<void> {
    await prisma.auditLog.create({
      data: {
        syncLinkId: data.syncLinkId,
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
