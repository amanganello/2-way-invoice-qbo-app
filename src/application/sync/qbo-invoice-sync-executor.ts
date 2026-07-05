import type { Invoice, QBOInvoicePort, QBOInvoiceResult, QBOSyncContext } from "@/domain/invoices/invoice.types.js";
import type { SyncLinkRecord } from "@/application/ports/sync.ports.js";
import { invoiceToSnapshot } from "./invoice-snapshot.js";
import { AuditRecorder, SyncAuditAction } from "./audit-recorder.js";
import {
  QboAlreadyVoidedError,
  QboDuplicateDocumentError,
  QboStaleObjectError,
} from "./qbo-sync-errors.js";
import { SyncLinkStateMachine } from "./sync-link-state-machine.js";

export type SyncDecision =
  | { type: "skip-void-without-link" }
  | { type: "void"; syncLink: SyncLinkRecord }
  | { type: "create"; version: number }
  | { type: "update"; syncLink: SyncLinkRecord };

export type SyncExecutionResult =
  | { outcome: "skipped" }
  | { outcome: "created"; result: QBOInvoiceResult }
  | { outcome: "updated"; result: QBOInvoiceResult }
  | { outcome: "voided"; result?: QBOInvoiceResult }
  | { outcome: "pending-after-stale-token" };

export class QboInvoiceSyncExecutor {
  constructor(
    private readonly qboInvoicePort: QBOInvoicePort,
    private readonly syncState: SyncLinkStateMachine,
    private readonly auditRecorder: AuditRecorder
  ) {}

  decide(invoice: Invoice, syncLink: SyncLinkRecord | null): SyncDecision {
    if (invoice.status === "void" && !syncLink?.qboId) return { type: "skip-void-without-link" };
    if (invoice.status === "void") return { type: "void", syncLink: syncLink! };
    if (!syncLink?.qboId) return { type: "create", version: syncLink?.version ?? 0 };
    return { type: "update", syncLink };
  }

  async execute(
    decision: SyncDecision,
    invoice: Invoice,
    ctx: QBOSyncContext,
    sourceEventId: string
  ): Promise<SyncExecutionResult> {
    switch (decision.type) {
      case "skip-void-without-link":
        await this.auditRecorder.success({
          action: SyncAuditAction.SkippedNoSyncLinkForVoid,
          sourceEventId,
        });
        return { outcome: "skipped" };
      case "void":
        return this.voidInvoice(decision.syncLink, sourceEventId);
      case "create":
        return this.createInvoice(invoice, ctx, decision.version, sourceEventId);
      case "update":
        return this.updateInvoice(decision.syncLink, invoice, ctx, sourceEventId);
    }
  }

  private async voidInvoice(syncLink: SyncLinkRecord, sourceEventId: string): Promise<SyncExecutionResult> {
    try {
      const result = await this.qboInvoicePort.voidInvoice(syncLink.qboId!, syncLink.qboSyncToken ?? "0");
      await this.syncState.markStatus(syncLink, "SYNCED", {
        qboSyncToken: result.qboSyncToken,
        qboUpdatedAt: result.qboUpdatedAt,
        lastSyncedAt: new Date(),
      });
      await this.auditRecorder.success({
        syncLinkId: syncLink.id,
        action: SyncAuditAction.VoidPushed,
        sourceEventId,
      });
      return { outcome: "voided", result };
    } catch (err) {
      if (err instanceof QboAlreadyVoidedError) {
        await this.syncState.markStatus(syncLink, "SYNCED", {});
        await this.auditRecorder.success({
          syncLinkId: syncLink.id,
          action: SyncAuditAction.VoidAlreadyApplied,
          sourceEventId,
        });
        return { outcome: "voided" };
      }
      throw err;
    }
  }

  private async createInvoice(
    invoice: Invoice,
    ctx: QBOSyncContext,
    version: number,
    sourceEventId: string
  ): Promise<SyncExecutionResult> {
    let result: QBOInvoiceResult;
    try {
      result = await this.qboInvoicePort.createInvoice(invoice, ctx);
    } catch (err) {
      if (!(err instanceof QboDuplicateDocumentError)) throw err;
      const existing = await this.qboInvoicePort.findByDocNumber(ctx.docNumber);
      if (!existing) throw err;
      result = existing;
    }

    const newLink = await this.syncState.upsertLinked(
      invoice.id,
      result.qboId,
      result.qboSyncToken,
      result.qboUpdatedAt,
      invoiceToSnapshot(invoice),
      version
    );
    await this.auditRecorder.success({
      syncLinkId: newLink.id,
      action: SyncAuditAction.InvoiceCreatedInQbo,
      sourceEventId,
      afterState: { qboId: result.qboId },
    });
    return { outcome: "created", result };
  }

  private async updateInvoice(
    syncLink: SyncLinkRecord,
    invoice: Invoice,
    ctx: QBOSyncContext,
    sourceEventId: string
  ): Promise<SyncExecutionResult> {
    let updateResult: QBOInvoiceResult;
    try {
      updateResult = await this.qboInvoicePort.updateInvoice(
        syncLink.qboId!,
        invoice,
        { ...ctx, syncToken: syncLink.qboSyncToken ?? "0" }
      );
    } catch (err) {
      if (!(err instanceof QboStaleObjectError)) throw err;
      const fresh = await this.qboInvoicePort.getInvoice(syncLink.qboId!);
      await this.syncState.markStatus(syncLink, "PENDING", {
        qboSyncToken: fresh.qboSyncToken,
        qboUpdatedAt: fresh.qboUpdatedAt,
      });
      return { outcome: "pending-after-stale-token" };
    }

    await this.syncState.markStatus(syncLink, "SYNCED", {
      qboSyncToken: updateResult.qboSyncToken,
      qboUpdatedAt: updateResult.qboUpdatedAt,
      lastSyncedSnapshot: invoiceToSnapshot(invoice),
      lastSyncedAt: new Date(),
    });
    await this.auditRecorder.success({
      syncLinkId: syncLink.id,
      action: SyncAuditAction.InvoiceUpdatedInQbo,
      sourceEventId,
      afterState: { qboId: updateResult.qboId },
    });
    return { outcome: "updated", result: updateResult };
  }
}
