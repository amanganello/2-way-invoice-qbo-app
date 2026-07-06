import { createHash } from "node:crypto";
import { ConflictError, NotFoundError } from "@/shared/errors/app-error.js";
import type {
  AccountMapPort,
  AuditLogPort,
  CustomerMapPort,
  ItemMapPort,
  QboCatalogPort,
  ReconcileQueuePort,
  SyncLinkPort,
  SyncStatusValue,
} from "@/application/ports/sync.ports.js";
import type { InvoiceRepository, QBOInvoicePort } from "@/domain/invoices/invoice.types.js";
import { invoiceToSnapshot } from "./invoice-snapshot.js";

export type SyncManagementDeps = {
  syncLinkRepo: SyncLinkPort;
  auditLogRepo: AuditLogPort;
  queue: ReconcileQueuePort;
  qboCatalog: QboCatalogPort;
  accountMapRepo: AccountMapPort;
  itemMapRepo: ItemMapPort;
  customerMapRepo: CustomerMapPort;
};

export async function listSyncLinks(
  deps: Pick<SyncManagementDeps, "syncLinkRepo">,
  params: { syncStatus?: SyncStatusValue; limit: number; cursor?: string }
) {
  return deps.syncLinkRepo.list(params);
}

export async function getSyncLinkDetail(
  deps: Pick<SyncManagementDeps, "syncLinkRepo" | "auditLogRepo">,
  id: string
) {
  const row = await deps.syncLinkRepo.findById(id);
  if (!row) throw new NotFoundError(`SyncLink ${id} not found`);
  const auditLogs = await deps.auditLogRepo.findBySyncLinkId(id);
  return { ...row, auditLogs };
}

export async function listConflicts(
  deps: Pick<SyncManagementDeps, "syncLinkRepo">,
  limit: number
) {
  return deps.syncLinkRepo.listConflicts(limit);
}

export async function resolveConflict(
  deps: Pick<SyncManagementDeps, "syncLinkRepo" | "queue">,
  id: string,
  strategy: "accept-internal" | "accept-qbo"
) {
  const syncLink = await deps.syncLinkRepo.findById(id);
  if (!syncLink || syncLink.syncStatus !== "CONFLICT") {
    throw new NotFoundError(`No CONFLICT SyncLink with id ${id}`);
  }

  if (strategy === "accept-internal") {
    await deps.syncLinkRepo.setStatus(syncLink.id, syncLink.version, "PENDING", {});
    await deps.queue.enqueueReconcile(syncLink.internalId);
  } else {
    await deps.syncLinkRepo.setStatus(syncLink.id, syncLink.version, "SYNCED", {});
  }

  return { ok: true, strategy, internalId: syncLink.internalId };
}

export async function runInitialInternalLoad(
  deps: Pick<SyncManagementDeps, "syncLinkRepo" | "queue">,
  limit = 500
) {
  const invoices = await deps.syncLinkRepo.findInvoicesWithoutSyncLink(limit);
  let enqueued = 0;

  for (const invoice of invoices) {
    await deps.syncLinkRepo.create({
      internalId: invoice.internalId,
      internalUpdatedAt: invoice.internalUpdatedAt ?? new Date(),
      syncStatus: "PENDING",
    });
    await deps.queue.enqueueReconcile(invoice.internalId);
    enqueued++;
  }

  return { enqueued, skipped: 0 };
}

export async function importQboMappings(deps: Pick<
  SyncManagementDeps,
  "qboCatalog" | "accountMapRepo" | "itemMapRepo" | "customerMapRepo"
>) {
  const [accounts, items, customers] = await Promise.all([
    deps.qboCatalog.fetchIncomeAccounts(),
    deps.qboCatalog.fetchItems(),
    deps.qboCatalog.fetchActiveCustomers(),
  ]);

  const accountsImported = await deps.accountMapRepo.upsertMany(
    accounts.map(account => ({
      internalAccountCode: account.FullyQualifiedName,
      qboAccountId: account.Id,
      qboAccountName: account.Name,
    }))
  );

  const itemsImported = await deps.itemMapRepo.upsertMany(
    items.map(item => ({
      internalItemCode: item.Name,
      qboItemId: item.Id,
      qboItemName: item.Name,
      defaultTaxCode: item.TaxCodeRef?.value ?? "NON",
    }))
  );

  const customersImported = await deps.customerMapRepo.upsertMany(
    customers.map(customer => ({
      internalCustomerId: customer.Id,
      qboCustomerId: customer.Id,
      qboCustomerName: customer.DisplayName,
    }))
  );

  return { accountsImported, itemsImported, customersImported };
}

function qboImportId(qboId: string): string {
  const hash = createHash("sha256").update(`qbo-import:${qboId}`).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

export async function runInitialQboLoad(
  deps: Pick<SyncManagementDeps, "syncLinkRepo"> & {
    invoiceRepo: InvoiceRepository;
    qboInvoicePort: QBOInvoicePort;
  },
  params: { limit: number; startPosition: number }
) {
  const { syncLinkRepo, invoiceRepo, qboInvoicePort } = deps;
  const results = await qboInvoicePort.listInvoices(params);

  let imported = 0;
  let skippedExisting = 0;

  for (const qboResult of results) {
    const existing = await syncLinkRepo.findByQboId(qboResult.qboId);
    if (existing) {
      skippedExisting++;
      continue;
    }

    const internalId = qboImportId(qboResult.qboId);

    // A prior partial run may have saved the invoice before crashing; the reconcile
    // worker may have then created a SyncLink for it (with a qboId from a fresh push).
    // In that case skip — the invoice is already managed, just under a different qboId.
    const existingByInternalId = await syncLinkRepo.findByInternalId(internalId);
    if (existingByInternalId) {
      skippedExisting++;
      continue;
    }

    try {
      const now = new Date();
      await invoiceRepo.save({ ...qboResult.invoice, id: internalId, createdAt: now, updatedAt: now });
      await syncLinkRepo.upsertLinked(
        internalId,
        qboResult.qboId,
        qboResult.qboSyncToken,
        qboResult.qboUpdatedAt,
        invoiceToSnapshot(qboResult.invoice),
        0
      );
      imported++;
    } catch (err) {
      // Safety net: if the reconcile worker raced between save and upsertLinked,
      // treat this invoice as already handled rather than aborting the whole batch.
      if (err instanceof ConflictError) {
        skippedExisting++;
        continue;
      }
      throw err;
    }
  }

  const scanned = results.length;
  return {
    scanned,
    imported,
    skippedExisting,
    startPosition: params.startPosition,
    nextStartPosition: scanned === params.limit ? params.startPosition + params.limit : null,
  };
}

export async function listMappings(deps: Pick<
  SyncManagementDeps,
  "accountMapRepo" | "itemMapRepo" | "customerMapRepo"
>) {
  const [accounts, items, customers] = await Promise.all([
    deps.accountMapRepo.findAll(),
    deps.itemMapRepo.findAll(),
    deps.customerMapRepo.findAll(),
  ]);
  return { accounts, items, customers };
}
