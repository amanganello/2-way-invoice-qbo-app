import type { InvoiceRepository } from "@/application/ports/invoice.ports.js";
import type { QBOInvoicePort } from "@/application/ports/qbo.ports.js";
import type {
  AccountMapPort,
  AuditLogPort,
  CustomerMapPort,
  ItemMapPort,
  PaymentSyncLinkPort,
  SyncLinkPort,
} from "@/application/ports/sync.ports.js";
import logger from "@/infrastructure/logger/index.js";
import { AuditRecorder, SyncAuditAction } from "./audit-recorder.js";
import { PartialPaymentPolicy } from "./partial-payment-policy.js";
import { QboInvoiceSyncExecutor } from "./qbo-invoice-sync-executor.js";
import { QboSyncContextResolver } from "./qbo-sync-context-resolver.js";
import { SyncLinkStateMachine } from "./sync-link-state-machine.js";

export type ReconcileDeps = {
  invoiceRepo: InvoiceRepository;
  syncLinkRepo: SyncLinkPort;
  paymentSyncLinkRepo: PaymentSyncLinkPort;
  // accountMapRepo: used to resolve internalAccountCode → qboAccountId per line item.
  // When a line item has internalAccountCode set, the mapped qboAccountId is included
  // as AccountRef in the QBO line (SalesItemLineDetail). Missing entries are an error.
  accountMapRepo: AccountMapPort;
  itemMapRepo: ItemMapPort;
  customerMapRepo: CustomerMapPort;
  qboInvoicePort: QBOInvoicePort;
  auditLogRepo: AuditLogPort;
  qbDefaultCustomerId?: string;
  qbDefaultItemId?: string;
  qbEnvironment: string;
};

export async function reconcileInvoice(internalId: string, deps: ReconcileDeps): Promise<void> {
  const sourceEventId = `reconcile-${internalId}`;
  const syncState = new SyncLinkStateMachine(deps.syncLinkRepo);
  const auditRecorder = new AuditRecorder(deps.auditLogRepo);
  const contextResolver = new QboSyncContextResolver({
    accountMapRepo: deps.accountMapRepo,
    itemMapRepo: deps.itemMapRepo,
    customerMapRepo: deps.customerMapRepo,
    qbDefaultCustomerId: deps.qbDefaultCustomerId,
    qbDefaultItemId: deps.qbDefaultItemId,
    qbEnvironment: deps.qbEnvironment,
  });
  const partialPaymentPolicy = new PartialPaymentPolicy(deps.paymentSyncLinkRepo);
  const executor = new QboInvoiceSyncExecutor(deps.qboInvoicePort, syncState, auditRecorder);

  const lock = await syncState.acquireProcessing(internalId);
  if (!lock.acquired) return;

  const invoice = await deps.invoiceRepo.findById(internalId);
  if (!invoice) {
    logger.warn({ internalId }, "reconcileInvoice: invoice not found");
    return;
  }

  const syncLink = lock.syncLink;

  try {
    if (syncLink?.qboId && invoice.status !== "void") {
      await partialPaymentPolicy.assertEditable(invoice, syncLink.lastSyncedSnapshot);
    }

    const decision = executor.decide(invoice, syncLink);
    const ctx = decision.type === "skip-void-without-link" || decision.type === "void"
      ? undefined
      : await contextResolver.resolve(invoice);
    const result = await executor.execute(decision, invoice, ctx!, sourceEventId);
    if (result.outcome === "pending-after-stale-token" && syncLink?.qboId) {
      logger.warn(
        { internalId, qboId: syncLink.qboId },
        "reconcileInvoice: stale SyncToken — refreshed from QBO, reset to PENDING for pull worker"
      );
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    if (syncLink) {
      await syncState.markError(syncLink, internalId);
      await auditRecorder.failure({
        syncLinkId: syncLink.id,
        action: SyncAuditAction.ReconcileFailed,
        sourceEventId,
        error,
      });
    }
    throw err;
  }
}
