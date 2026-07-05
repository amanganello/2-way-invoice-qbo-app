import type { AuditLogPort } from "@/application/ports/sync.ports.js";

export const SyncAuditAction = {
  SkippedNoSyncLinkForVoid: "skipped_no_sync_link_for_void",
  VoidPushed: "void_pushed",
  VoidAlreadyApplied: "void_already_applied",
  InvoiceCreatedInQbo: "invoice_created_in_qbo",
  InvoiceUpdatedInQbo: "invoice_updated_in_qbo",
  ReconcileFailed: "reconcile_failed",
} as const;

export type SyncAuditAction = typeof SyncAuditAction[keyof typeof SyncAuditAction];

export class AuditRecorder {
  constructor(private readonly auditLogRepo: AuditLogPort) {}

  async success(data: {
    syncLinkId?: string;
    action: SyncAuditAction;
    sourceEventId: string;
    afterState?: Record<string, unknown>;
  }): Promise<void> {
    await this.auditLogRepo.create({
      syncLinkId: data.syncLinkId,
      action: data.action,
      sourceEventId: data.sourceEventId,
      result: "SUCCESS",
      afterState: data.afterState,
    });
  }

  async failure(data: {
    syncLinkId?: string;
    action: SyncAuditAction;
    sourceEventId: string;
    error: string;
  }): Promise<void> {
    await this.auditLogRepo.create({
      syncLinkId: data.syncLinkId,
      action: data.action,
      sourceEventId: data.sourceEventId,
      result: "FAILURE",
      error: data.error,
    });
  }
}
