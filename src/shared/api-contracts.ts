export type ApiLineItem = {
  description: string;
  quantity: number;
  unitPrice: string;
  amount: string;
  internalItemCode?: string;
  internalAccountCode?: string;
};

export type CreateInvoiceBody = {
  customerId: string;
  lineItems: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    amount: number;
  }>;
  totalAmount: number;
  currency: string;
  status: string;
  dueDate: string;
};

export type InvoiceResponse = {
  id: string;
  customerId: string;
  lineItems: ApiLineItem[];
  totalAmount: string;
  currency: string;
  status: string;
  dueDate: string;
  createdAt: string;
  updatedAt: string;
};

export type SyncLinkResponse = {
  id: string;
  internalId: string;
  qboId: string | null;
  qboSyncToken: string | null;
  qboUpdatedAt: string | null;
  internalUpdatedAt: string;
  syncStatus: "SYNCED" | "PENDING" | "PROCESSING" | "CONFLICT" | "ERROR";
  lastSyncedAt: string | null;
  lastSyncedSnapshot: Record<string, unknown> | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type AuditLogResponse = {
  id: string;
  syncLinkId: string | null;
  action: string;
  sourceEventId: string;
  beforeState: Record<string, unknown> | null;
  afterState: Record<string, unknown> | null;
  result: "SUCCESS" | "FAILURE";
  error: string | null;
  createdAt: string;
};

export type SyncLinkDetailResponse = SyncLinkResponse & {
  auditLogs: AuditLogResponse[];
};

export type AccountMapResponse = {
  internalAccountCode: string;
  qboAccountId: string;
  qboAccountName: string;
};

export type ItemMapResponse = {
  internalItemCode: string;
  qboItemId: string;
  qboItemName: string;
  defaultTaxCode: string;
};

export type CustomerMapResponse = {
  internalCustomerId: string;
  qboCustomerId: string;
  qboCustomerName: string;
};

export type MappingResponse = {
  accounts: AccountMapResponse[];
  items: ItemMapResponse[];
  customers: CustomerMapResponse[];
};
