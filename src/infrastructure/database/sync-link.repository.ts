import { prisma } from "./prisma.js";
import type { SyncStatus } from "@prisma/client";
import { ConflictError } from "@/shared/errors/app-error.js";

export type SyncLinkRecord = {
  id: string;
  internalId: string;
  qboId: string | null;
  qboSyncToken: string | null;
  qboUpdatedAt: Date | null;
  internalUpdatedAt: Date;
  syncStatus: "SYNCED" | "PENDING" | "PROCESSING" | "CONFLICT" | "ERROR";
  lastSyncedAt: Date | null;
  lastSyncedSnapshot: Record<string, unknown> | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

function toDomain(row: {
  id: string; internalId: string; qboId: string | null; qboSyncToken: string | null;
  qboUpdatedAt: Date | null; internalUpdatedAt: Date; syncStatus: SyncStatus;
  lastSyncedAt: Date | null; lastSyncedSnapshot: unknown; version: number;
  createdAt: Date; updatedAt: Date;
}): SyncLinkRecord {
  return {
    ...row,
    syncStatus: row.syncStatus as SyncLinkRecord["syncStatus"],
    lastSyncedSnapshot: row.lastSyncedSnapshot as Record<string, unknown> | null,
  };
}

export const syncLinkRepository = {
  async findByInternalId(internalId: string): Promise<SyncLinkRecord | null> {
    const row = await prisma.syncLink.findUnique({ where: { internalId } });
    return row ? toDomain(row) : null;
  },

  async findByQboId(qboId: string): Promise<SyncLinkRecord | null> {
    const row = await prisma.syncLink.findFirst({ where: { qboId } });
    return row ? toDomain(row) : null;
  },

  async create(data: {
    internalId: string;
    internalUpdatedAt: Date;
    syncStatus?: SyncLinkRecord["syncStatus"];
  }): Promise<SyncLinkRecord> {
    const row = await prisma.syncLink.create({
      data: {
        internalId: data.internalId,
        internalUpdatedAt: data.internalUpdatedAt,
        syncStatus: (data.syncStatus ?? "PENDING") as SyncStatus,
      },
    });
    return toDomain(row);
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
        syncStatus: status as SyncStatus,
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
      const updated = await prisma.syncLink.findUnique({ where: { id: existing.id } });
      return toDomain(updated!);
    }
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
  },

  async findByStatuses(statuses: SyncLinkRecord["syncStatus"][]): Promise<SyncLinkRecord[]> {
    const rows = await prisma.syncLink.findMany({
      where: { syncStatus: { in: statuses as SyncStatus[] } },
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
      where: { lastSyncedAt: null },
    });
    return rows.map(toDomain);
  },

  async findInvoicesWithoutSyncLink(): Promise<{ internalId: string }[]> {
    const invoices = await prisma.invoice.findMany({
      where: { syncLink: { is: null } },
      select: { id: true },
    });
    return invoices.map(inv => ({ internalId: inv.id }));
  },
};

export type SyncLinkRepository = typeof syncLinkRepository;
