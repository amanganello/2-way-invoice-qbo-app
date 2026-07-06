import type { SyncLinkPort, SyncLinkRecord, SyncStatusValue } from "@/application/ports/sync.ports.js";
import logger from "@/infrastructure/logger/index.js";

export type SyncLinkLock =
  | { acquired: true; syncLink: SyncLinkRecord | null }
  | { acquired: false };

export class SyncLinkStateMachine {
  constructor(private readonly syncLinkRepo: SyncLinkPort) {}

  async acquireProcessing(internalId: string): Promise<SyncLinkLock> {
    let syncLink = await this.syncLinkRepo.findByInternalId(internalId);
    if (!syncLink) {
      syncLink = await this.syncLinkRepo.create({
        internalId,
        internalUpdatedAt: new Date(),
        syncStatus: "PENDING",
      });
    }

    const locked = await this.syncLinkRepo.setProcessing(syncLink.id, syncLink.version);
    if (!locked) return { acquired: false };

    return {
      acquired: true,
      syncLink: await this.syncLinkRepo.findByInternalId(internalId) ?? {
        ...syncLink,
        syncStatus: "PROCESSING",
        version: syncLink.version + 1,
        updatedAt: new Date(),
      },
    };
  }

  async markStatus(
    syncLink: SyncLinkRecord,
    status: SyncStatusValue,
    updates: Parameters<SyncLinkPort["setStatus"]>[3] = {}
  ): Promise<SyncLinkRecord> {
    return this.syncLinkRepo.setStatus(syncLink.id, syncLink.version, status, updates);
  }

  async markError(syncLink: SyncLinkRecord, internalId: string): Promise<void> {
    try {
      await this.markStatus(syncLink, "ERROR", {});
    } catch {
      logger.warn({ internalId }, "reconcileInvoice: failed to set ERROR status (version conflict)");
    }
  }

  async upsertLinked(...args: Parameters<SyncLinkPort["upsertLinked"]>): ReturnType<SyncLinkPort["upsertLinked"]> {
    return this.syncLinkRepo.upsertLinked(...args);
  }
}
