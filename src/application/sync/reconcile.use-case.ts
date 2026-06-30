import type { Invoice, InvoiceRepository, QBOInvoicePort, QBOSyncContext } from "@/domain/invoices/invoice.types.js";
import type { SyncLinkRepository, SyncLinkRecord } from "@/infrastructure/database/sync-link.repository.js";
import { ExternalServiceError, ConflictError } from "@/shared/errors/app-error.js";
import logger from "@/infrastructure/logger/index.js";

// Inline port types — the infra repositories satisfy these shapes
type PaymentSyncLinkPort = {
  findByInvoiceInternalId: (invoiceInternalId: string) => Promise<Array<{ id: string }>>;
};

type AuditLogPort = {
  create: (data: {
    syncLinkId?: string;
    action: string;
    sourceEventId: string;
    beforeState?: Record<string, unknown>;
    afterState?: Record<string, unknown>;
    result: "SUCCESS" | "FAILURE";
    error?: string;
  }) => Promise<void>;
};

export type ReconcileDeps = {
  invoiceRepo: InvoiceRepository;
  syncLinkRepo: SyncLinkRepository;
  paymentSyncLinkRepo: PaymentSyncLinkPort;
  accountMapRepo: { findByInternalCode: (code: string) => Promise<{ qboAccountId: string } | null> };
  itemMapRepo: { findByInternalCode: (code: string) => Promise<{ qboItemId: string; defaultTaxCode: string } | null> };
  customerMapRepo: { findByInternalId: (id: string) => Promise<{ qboCustomerId: string } | null> };
  qboInvoicePort: QBOInvoicePort;
  auditLogRepo: AuditLogPort;
  qbDefaultCustomerId?: string;
  qbEnvironment: string;
};

function invoiceToSnapshot(invoice: Invoice): Record<string, unknown> {
  return {
    customerId: invoice.customerId,
    lineItems: invoice.lineItems,
    totalAmount: invoice.totalAmount,
    currency: invoice.currency,
    status: invoice.status,
    dueDate: invoice.dueDate instanceof Date ? invoice.dueDate.toISOString() : invoice.dueDate,
  };
}

export async function reconcileInvoice(internalId: string, deps: ReconcileDeps): Promise<void> {
  const {
    invoiceRepo, syncLinkRepo, paymentSyncLinkRepo,
    itemMapRepo, customerMapRepo,
    qboInvoicePort, auditLogRepo,
    qbDefaultCustomerId, qbEnvironment,
  } = deps;

  const sourceEventId = `reconcile-${internalId}`;

  // Re-read SyncLink at job time — never use stale payload
  let syncLink: SyncLinkRecord | null = await syncLinkRepo.findByInternalId(internalId);

  // Set PROCESSING via optimistic lock
  if (syncLink) {
    const locked = await syncLinkRepo.setProcessing(syncLink.id, syncLink.version);
    if (!locked) return; // another worker owns this record
    // Re-read to refresh version after setProcessing incremented it
    syncLink = await syncLinkRepo.findByInternalId(internalId);
  }

  const invoice = await invoiceRepo.findById(internalId);
  if (!invoice) {
    logger.warn({ internalId }, "reconcileInvoice: invoice not found");
    return;
  }

  const hasQboId = Boolean(syncLink?.qboId);

  try {
    // void + no qboId → no-op (invoice never reached QBO); write AuditLog and return
    if (invoice.status === "void" && !hasQboId) {
      await auditLogRepo.create({
        action: "skipped_no_sync_link_for_void",
        sourceEventId,
        result: "SUCCESS",
      });
      return;
    }

    // void + SyncLink exists → voidInvoice (no customer/item resolution needed)
    if (invoice.status === "void" && hasQboId) {
      try {
        const result = await qboInvoicePort.voidInvoice(syncLink!.qboId!, syncLink!.qboSyncToken ?? "0");
        await syncLinkRepo.setStatus(syncLink!.id, syncLink!.version, "SYNCED", {
          qboSyncToken: result.qboSyncToken,
          qboUpdatedAt: result.qboUpdatedAt,
          lastSyncedAt: new Date(),
        });
        await auditLogRepo.create({
          syncLinkId: syncLink!.id,
          action: "void_pushed",
          sourceEventId,
          result: "SUCCESS",
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("422") || msg.toLowerCase().includes("already voided")) {
          await syncLinkRepo.setStatus(syncLink!.id, syncLink!.version, "SYNCED", {});
          await auditLogRepo.create({
            syncLinkId: syncLink!.id,
            action: "void_already_applied",
            sourceEventId,
            result: "SUCCESS",
          });
          return;
        }
        throw err;
      }
      return;
    }

    // Resolve CustomerRef (only needed for create and update paths)
    let customerRef: string;
    const customerEntry = await customerMapRepo.findByInternalId(invoice.customerId);
    if (customerEntry) {
      customerRef = customerEntry.qboCustomerId;
    } else if (qbEnvironment === "sandbox" && qbDefaultCustomerId) {
      customerRef = qbDefaultCustomerId;
    } else {
      throw new ExternalServiceError(`No CustomerMap entry for customer: ${invoice.customerId}`);
    }

    // Build itemMap for line items with internalItemCode
    const itemMap = new Map<string, { qboItemId: string; taxCode: string }>();
    const codes = [...new Set(
      invoice.lineItems
        .map(li => li.internalItemCode)
        .filter((c): c is string => Boolean(c))
    )];
    for (const code of codes) {
      const entry = await itemMapRepo.findByInternalCode(code);
      if (!entry) throw new ExternalServiceError(`No ItemMap entry for code: ${code}`);
      itemMap.set(code, { qboItemId: entry.qboItemId, taxCode: entry.defaultTaxCode });
    }

    const ctx: QBOSyncContext = { customerRef, itemMap, docNumber: internalId };

    // Partially-paid guard: only block lineItems/totalAmount changes.
    // Other fields (dueDate, currency, status) are allowed even on partially-paid invoices.
    if (hasQboId && syncLink) {
      const payments = await paymentSyncLinkRepo.findByInvoiceInternalId(internalId);
      if (payments.length > 0 && syncLink.lastSyncedSnapshot) {
        const snap = syncLink.lastSyncedSnapshot as Record<string, unknown>;
        const lineItemsChanged =
          JSON.stringify(invoice.lineItems) !== JSON.stringify(snap.lineItems);
        const totalAmountChanged = invoice.totalAmount !== (snap.totalAmount as number);

        if (lineItemsChanged || totalAmountChanged) {
          throw new ConflictError(
            `Invoice ${internalId} has ${payments.length} linked payment(s); ` +
            `lineItems and totalAmount cannot be modified on a partially-paid invoice`
          );
        }
        // Other fields changed — allowed, continue with update
      }
    }

    if (!hasQboId) {
      // createInvoice with duplicate idempotency
      let result;
      try {
        result = await qboInvoicePort.createInvoice(invoice, ctx);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("6240") || msg.toLowerCase().includes("duplicate")) {
          const existing = await qboInvoicePort.findByDocNumber(internalId);
          if (!existing) throw err;
          result = existing;
        } else {
          throw err;
        }
      }
      const newLink = await syncLinkRepo.upsertLinked(
        internalId, result.qboId, result.qboSyncToken, result.qboUpdatedAt,
        invoiceToSnapshot(invoice),
        0 // no existing sync link to conflict with
      );
      await auditLogRepo.create({
        syncLinkId: newLink.id,
        action: "invoice_created_in_qbo",
        sourceEventId,
        result: "SUCCESS",
        afterState: { qboId: result.qboId },
      });
    } else {
      const result = await qboInvoicePort.updateInvoice(
        syncLink!.qboId!, invoice, { ...ctx, syncToken: syncLink!.qboSyncToken ?? "0" }
      );
      await syncLinkRepo.setStatus(syncLink!.id, syncLink!.version, "SYNCED", {
        qboSyncToken: result.qboSyncToken,
        qboUpdatedAt: result.qboUpdatedAt,
        lastSyncedSnapshot: invoiceToSnapshot(invoice),
        lastSyncedAt: new Date(),
      });
      await auditLogRepo.create({
        syncLinkId: syncLink!.id,
        action: "invoice_updated_in_qbo",
        sourceEventId,
        result: "SUCCESS",
        afterState: { qboId: result.qboId },
      });
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    if (syncLink) {
      try {
        await syncLinkRepo.setStatus(syncLink.id, syncLink.version, "ERROR", {});
      } catch {
        // Version conflict — a previous setStatus already succeeded (e.g. audit log write failed).
        // Log and continue so the original error is still re-thrown.
        logger.warn({ internalId }, "reconcileInvoice: failed to set ERROR status (version conflict)");
      }
      await auditLogRepo.create({
        syncLinkId: syncLink.id,
        action: "reconcile_failed",
        sourceEventId,
        result: "FAILURE",
        error,
      });
    }
    throw err;
  }
}
