import { prisma } from "./prisma.js";
import { Prisma, type SyncStatus } from "@prisma/client";
import { ConflictError } from "@/shared/errors/app-error.js";
import type { AuditLogRecord, SyncLinkPort, SyncLinkRecord } from "@/application/ports/sync.ports.js";

function toDomain(row: {
  id: string; internalId: string; qboId: string | null; qboSyncToken: string | null;
  qboUpdatedAt: Date | null; internalUpdatedAt: Date; syncStatus: SyncStatus;
  lastSyncedAt: Date | null; lastSyncedSnapshot: unknown; version: number;
  createdAt: Date; updatedAt: Date;
}): SyncLinkRecord {
  return {
    ...row,
    syncStatus: row.syncStatus,
    lastSyncedSnapshot: row.lastSyncedSnapshot as Record<string, unknown> | null,
  };
}

export const syncLinkRepository: SyncLinkPort = {
  async findByInternalId(internalId: string): Promise<SyncLinkRecord | null> {
    const row = await prisma.syncLink.findUnique({ where: { internalId } });
    return row ? toDomain(row) : null;
  },

  async findById(id: string): Promise<SyncLinkRecord | null> {
    const row = await prisma.syncLink.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  },

  async findByQboId(qboId: string): Promise<SyncLinkRecord | null> {
    const row = await prisma.syncLink.findFirst({ where: { qboId } });
    return row ? toDomain(row) : null;
  },

  async list(params: { syncStatus?: SyncLinkRecord["syncStatus"]; limit: number; cursor?: string }): Promise<SyncLinkRecord[]> {
    const rows = await prisma.syncLink.findMany({
      where: params.syncStatus ? { syncStatus: params.syncStatus } : undefined,
      orderBy: { createdAt: "desc" },
      take: params.limit,
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
    });
    return rows.map(toDomain);
  },

  async listConflicts(limit: number): Promise<Array<SyncLinkRecord & { auditLogs?: AuditLogRecord[] }>> {
    const rows = await prisma.syncLink.findMany({
      where: { syncStatus: "CONFLICT" },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { auditLogs: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    return rows.map(row => ({
      ...toDomain(row),
      auditLogs: row.auditLogs as AuditLogRecord[],
    }));
  },

  async create(data: {
    internalId: string;
    internalUpdatedAt: Date;
    syncStatus?: SyncLinkRecord["syncStatus"];
  }): Promise<SyncLinkRecord> {
    try {
      const row = await prisma.syncLink.create({
        data: {
          internalId: data.internalId,
          internalUpdatedAt: data.internalUpdatedAt,
          syncStatus: data.syncStatus ?? "PENDING",
        },
      });
      return toDomain(row);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const existing = await prisma.syncLink.findUnique({ where: { internalId: data.internalId } });
        if (existing) return toDomain(existing);
      }
      throw err;
    }
  },

  async setProcessing(id: string, version: number): Promise<boolean> {
    const result = await prisma.syncLink.updateMany({
      where: { id, version },
      data: { syncStatus: "PROCESSING", version: { increment: 1 } },
    });
    return result.count > 0;
  },

  async setStatus(
    id: string,
    version: number,
    status: SyncLinkRecord["syncStatus"],
    updates: {
      qboId?: string;
      qboSyncToken?: string;
      qboUpdatedAt?: Date;
      lastSyncedSnapshot?: Record<string, unknown>;
      lastSyncedAt?: Date;
    }
  ): Promise<SyncLinkRecord> {
    const result = await prisma.syncLink.updateMany({
      where: { id, version },
      data: {
        syncStatus: status,
        version: { increment: 1 },
        ...updates,
        lastSyncedSnapshot: updates.lastSyncedSnapshot
          ? JSON.parse(JSON.stringify(updates.lastSyncedSnapshot))
          : undefined,
      },
    });
    if (result.count === 0) {
      throw new ConflictError("Optimistic lock conflict on SyncLink");
    }
    const row = await prisma.syncLink.findUnique({ where: { id } });
    return toDomain(row!);
  },

  async upsertLinked(
    internalId: string,
    qboId: string,
    qboSyncToken: string,
    qboUpdatedAt: Date,
    snapshot: Record<string, unknown>,
    version: number
  ): Promise<SyncLinkRecord> {
    const existing = await prisma.syncLink.findUnique({ where: { internalId } });
    if (existing) {
      try {
        const result = await prisma.syncLink.updateMany({
          where: { id: existing.id, version },
          data: {
            qboId, qboSyncToken, qboUpdatedAt,
            lastSyncedSnapshot: JSON.parse(JSON.stringify(snapshot)),
            lastSyncedAt: new Date(),
            syncStatus: "SYNCED",
            version: { increment: 1 },
          },
        });
        if (result.count === 0) {
          throw new ConflictError("Optimistic lock conflict on SyncLink in upsertLinked");
        }
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          const existingByQboId = await prisma.syncLink.findUnique({ where: { qboId } });
          if (existingByQboId) return toDomain(existingByQboId);
        }
        throw err;
      }
      const updated = await prisma.syncLink.findUnique({ where: { id: existing.id } });
      return toDomain(updated!);
    }
    try {
      const created = await prisma.syncLink.create({
        data: {
          internalId, qboId, qboSyncToken, qboUpdatedAt,
          internalUpdatedAt: new Date(),
          lastSyncedSnapshot: JSON.parse(JSON.stringify(snapshot)),
          lastSyncedAt: new Date(),
          syncStatus: "SYNCED",
        },
      });
      return toDomain(created);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const existingByQboId = await prisma.syncLink.findUnique({ where: { qboId } });
        if (existingByQboId) return toDomain(existingByQboId);
        const existingByInternalId = await prisma.syncLink.findUnique({ where: { internalId } });
        if (existingByInternalId) return toDomain(existingByInternalId);
      }
      throw err;
    }
  },

  async findByStatuses(statuses: SyncLinkRecord["syncStatus"][]): Promise<SyncLinkRecord[]> {
    const rows = await prisma.syncLink.findMany({
      where: { syncStatus: { in: statuses } },
    });
    return rows.map(toDomain);
  },

  async findStuckProcessing(olderThanMinutes: number): Promise<SyncLinkRecord[]> {
    const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000);
    const rows = await prisma.syncLink.findMany({
      where: { syncStatus: "PROCESSING", updatedAt: { lt: cutoff } },
    });
    return rows.map(toDomain);
  },

  async findUnsynced(): Promise<SyncLinkRecord[]> {
    const rows = await prisma.syncLink.findMany({
      where: {
        lastSyncedAt: null,
        syncStatus: { notIn: ["CONFLICT", "PROCESSING"] },
      },
    });
    return rows.map(toDomain);
  },

  async findInvoicesWithoutSyncLink(limit = 500): Promise<Array<{ internalId: string; internalUpdatedAt: Date }>> {
    const invoices = await prisma.invoice.findMany({
      where: {
        syncLink: { is: null },
        id: { not: { startsWith: "qbo-" } },
      },
      select: { id: true, updatedAt: true },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
    return invoices.map(inv => ({ internalId: inv.id, internalUpdatedAt: inv.updatedAt }));
  },
};

export type SyncLinkRepository = typeof syncLinkRepository;
