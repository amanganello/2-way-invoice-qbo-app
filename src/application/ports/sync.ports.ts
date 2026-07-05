import type { Invoice } from "@/domain/invoices/invoice.types.js";

export type SyncStatusValue = "SYNCED" | "PENDING" | "PROCESSING" | "CONFLICT" | "ERROR";

export type SyncLinkRecord = {
  id: string;
  internalId: string;
  qboId: string | null;
  qboSyncToken: string | null;
  qboUpdatedAt: Date | null;
  internalUpdatedAt: Date;
  syncStatus: SyncStatusValue;
  lastSyncedAt: Date | null;
  lastSyncedSnapshot: Record<string, unknown> | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

export type AuditLogRecord = {
  id: string;
  syncLinkId: string | null;
  action: string;
  sourceEventId: string;
  beforeState: Record<string, unknown> | null;
  afterState: Record<string, unknown> | null;
  result: "SUCCESS" | "FAILURE";
  error: string | null;
  createdAt: Date;
};

export type PaymentSyncLinkRecord = {
  id: string;
  internalId: string;
  qboId: string;
  invoiceInternalId: string;
  syncStatus: "SYNCED" | "PENDING" | "ERROR";
  lastSyncedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type AccountMapEntry = {
  internalAccountCode: string;
  qboAccountId: string;
  qboAccountName: string;
};

export type ItemMapEntry = {
  internalItemCode: string;
  qboItemId: string;
  qboItemName: string;
  defaultTaxCode: string;
};

export type CustomerMapEntry = {
  internalCustomerId: string;
  qboCustomerId: string;
  qboCustomerName: string;
};

export type QboAccount = {
  Id: string;
  Name: string;
  FullyQualifiedName: string;
};

export type QboItem = {
  Id: string;
  Name: string;
  TaxCodeRef?: { value: string };
};

export type QboCustomer = {
  Id: string;
  DisplayName: string;
};

export interface SyncLinkPort {
  findByInternalId(internalId: string): Promise<SyncLinkRecord | null>;
  findByQboId(qboId: string): Promise<SyncLinkRecord | null>;
  findById(id: string): Promise<SyncLinkRecord | null>;
  list(params: { syncStatus?: SyncStatusValue; limit: number; cursor?: string }): Promise<SyncLinkRecord[]>;
  listConflicts(limit: number): Promise<Array<SyncLinkRecord & { auditLogs?: AuditLogRecord[] }>>;
  create(data: { internalId: string; internalUpdatedAt: Date; syncStatus?: SyncStatusValue }): Promise<SyncLinkRecord>;
  setProcessing(id: string, version: number): Promise<boolean>;
  setStatus(
    id: string,
    version: number,
    status: SyncStatusValue,
    updates: {
      qboId?: string;
      qboSyncToken?: string;
      qboUpdatedAt?: Date;
      lastSyncedSnapshot?: Record<string, unknown>;
      lastSyncedAt?: Date;
    }
  ): Promise<SyncLinkRecord>;
  upsertLinked(
    internalId: string,
    qboId: string,
    qboSyncToken: string,
    qboUpdatedAt: Date,
    snapshot: Record<string, unknown>,
    version: number
  ): Promise<SyncLinkRecord>;
  findByStatuses(statuses: SyncStatusValue[]): Promise<SyncLinkRecord[]>;
  findStuckProcessing(olderThanMinutes: number): Promise<SyncLinkRecord[]>;
  findUnsynced(): Promise<SyncLinkRecord[]>;
  findInvoicesWithoutSyncLink(limit?: number): Promise<Array<{ internalId: string; internalUpdatedAt?: Date }>>;
}

export interface AuditLogPort {
  create(data: {
    syncLinkId?: string;
    action: string;
    sourceEventId: string;
    beforeState?: Record<string, unknown>;
    afterState?: Record<string, unknown>;
    result: "SUCCESS" | "FAILURE";
    error?: string;
  }): Promise<void>;
  findBySyncLinkId(syncLinkId: string): Promise<AuditLogRecord[]>;
}

export interface PaymentSyncLinkPort {
  findByInternalId(internalId: string): Promise<PaymentSyncLinkRecord | null>;
  findByInvoiceInternalId(invoiceInternalId: string): Promise<PaymentSyncLinkRecord[]>;
  create(data: {
    internalId: string;
    qboId: string;
    invoiceInternalId: string;
    syncStatus?: "SYNCED" | "PENDING" | "ERROR";
  }): Promise<PaymentSyncLinkRecord>;
}

export interface AccountMapPort {
  findByInternalCode(code: string): Promise<Pick<AccountMapEntry, "qboAccountId"> | null>;
  upsertMany(items: AccountMapEntry[]): Promise<number>;
  findAll(): Promise<AccountMapEntry[]>;
}

export interface ItemMapPort {
  findByInternalCode(code: string): Promise<Pick<ItemMapEntry, "qboItemId" | "defaultTaxCode"> | null>;
  upsertMany(items: ItemMapEntry[]): Promise<number>;
  findAll(): Promise<ItemMapEntry[]>;
}

export interface CustomerMapPort {
  findByInternalId(id: string): Promise<Pick<CustomerMapEntry, "qboCustomerId"> | null>;
  upsertMany(items: CustomerMapEntry[]): Promise<number>;
  findAll(): Promise<CustomerMapEntry[]>;
}

export interface QboCatalogPort {
  fetchIncomeAccounts(): Promise<QboAccount[]>;
  fetchItems(): Promise<QboItem[]>;
  fetchActiveCustomers(): Promise<QboCustomer[]>;
}

export interface ReconcileQueuePort {
  enqueueReconcile(internalId: string): Promise<void>;
}

export interface InvoiceListPort {
  findInvoicesWithoutSyncLink(limit?: number): Promise<Array<{ internalId: string; internalUpdatedAt?: Date }>>;
}

export type InvoiceSnapshotPort = {
  invoiceToSnapshot(invoice: Invoice): Record<string, unknown>;
};
