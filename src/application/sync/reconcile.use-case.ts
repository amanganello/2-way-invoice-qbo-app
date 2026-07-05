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
  // accountMapRepo: used to resolve internalAccountCode → qboAccountId per line item.
  // When a line item has internalAccountCode set, the mapped qboAccountId is included
  // as AccountRef in the QBO line (SalesItemLineDetail). Missing entries are an error.
  accountMapRepo: { findByInternalCode: (code: string) => Promise<{ qboAccountId: string } | null> };
  itemMapRepo: { findByInternalCode: (code: string) => Promise<{ qboItemId: string; defaultTaxCode: string } | null> };
  customerMapRepo: { findByInternalId: (id: string) => Promise<{ qboCustomerId: string } | null> };
  qboInvoicePort: QBOInvoicePort;
  auditLogRepo: AuditLogPort;
  qbDefaultCustomerId?: string;
  qbDefaultItemId?: string;
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
    accountMapRepo, itemMapRepo, customerMapRepo,
    qboInvoicePort, auditLogRepo,
    qbDefaultCustomerId, qbDefaultItemId, qbEnvironment,
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

    // Build accountMap for line items with internalAccountCode
    const accountMap = new Map<string, { qboAccountId: string }>();
    const accountCodes = [...new Set(
      invoice.lineItems
        .map(li => li.internalAccountCode)
        .filter((c): c is string => Boolean(c))
    )];
    for (const code of accountCodes) {
      const entry = await accountMapRepo.findByInternalCode(code);
      if (!entry) throw new ExternalServiceError(`No AccountMap entry for code: ${code}`);
      accountMap.set(code, { qboAccountId: entry.qboAccountId });
    }

    // QBO DocNumber max length is 21 chars; UUIDs are 36. Truncate to keep it unique enough.
    const docNumber = internalId.replace(/-/g, "").slice(0, 20);
    const ctx: QBOSyncContext = { customerRef, itemMap, accountMap, docNumber, defaultItemId: qbDefaultItemId };

    // Partially-paid guard: only block lineItems/totalAmount changes.
    // Other fields (dueDate, currency, status) are allowed even on partially-paid invoices.
    if (hasQboId && syncLink) {
      const payments = await paymentSyncLinkRepo.findByInvoiceInternalId(internalId);
      if (payments.length > 0 && syncLink.lastSyncedSnapshot) {
        const snap = syncLink.lastSyncedSnapshot as Record<string, unknown>;
        const normalizeLineItems = (items: unknown) =>
          Array.isArray(items)
            ? (items as Array<{ description: string; quantity: number; unitPrice: number | string; amount: number | string; [key: string]: unknown }>)
                .map(li => ({
                  ...li,
                  unitPrice: Number(li.unitPrice).toFixed(2),
                  amount: Number(li.amount).toFixed(2),
                }))
            : items;
        const lineItemsChanged =
          JSON.stringify(invoice.lineItems) !== JSON.stringify(normalizeLineItems(snap.lineItems));
        const totalAmountChanged = invoice.totalAmount !== Number(snap.totalAmount).toFixed(2);

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
          const existing = await qboInvoicePort.findByDocNumber(docNumber);
          if (!existing) throw err;
          result = existing;
        } else {
          throw err;
        }
      }
      const newLink = await syncLinkRepo.upsertLinked(
        internalId, result.qboId, result.qboSyncToken, result.qboUpdatedAt,
        invoiceToSnapshot(invoice),
        syncLink?.version ?? 0
      );
      await auditLogRepo.create({
        syncLinkId: newLink.id,
        action: "invoice_created_in_qbo",
        sourceEventId,
        result: "SUCCESS",
        afterState: { qboId: result.qboId },
      });
    } else {
      let updateResult;
      try {
        updateResult = await qboInvoicePort.updateInvoice(
          syncLink!.qboId!, invoice, { ...ctx, syncToken: syncLink!.qboSyncToken ?? "0" }
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.toLowerCase().includes("stale object") || msg.toLowerCase().includes("stale")) {
          // QBO was updated externally since our last sync — refresh the SyncToken and
          // reset to PENDING. The pull worker (enqueued when QBO fired its webhook) will
          // run conflict detection and set CONFLICT or apply the merged result.
          const fresh = await qboInvoicePort.getInvoice(syncLink!.qboId!);
          await syncLinkRepo.setStatus(syncLink!.id, syncLink!.version, "PENDING", {
            qboSyncToken: fresh.qboSyncToken,
            qboUpdatedAt: fresh.qboUpdatedAt,
          });
          logger.warn({ internalId, qboId: syncLink!.qboId }, "reconcileInvoice: stale SyncToken — refreshed from QBO, reset to PENDING for pull worker");
          return;
        }
        throw err;
      }
      await syncLinkRepo.setStatus(syncLink!.id, syncLink!.version, "SYNCED", {
        qboSyncToken: updateResult.qboSyncToken,
        qboUpdatedAt: updateResult.qboUpdatedAt,
        lastSyncedSnapshot: invoiceToSnapshot(invoice),
        lastSyncedAt: new Date(),
      });
      await auditLogRepo.create({
        syncLinkId: syncLink!.id,
        action: "invoice_updated_in_qbo",
        sourceEventId,
        result: "SUCCESS",
        afterState: { qboId: updateResult.qboId },
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
