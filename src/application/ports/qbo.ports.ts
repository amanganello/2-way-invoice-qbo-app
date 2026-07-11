import type { Invoice, Payment } from "@/domain/invoices/invoice.types.js";

export type QBOSyncContext = {
  customerRef: string;
  itemMap: Map<string, { qboItemId: string; taxCode: string }>;
  accountMap: Map<string, { qboAccountId: string }>;
  docNumber: string;
  syncToken?: string;
  defaultItemId?: string;
};

export type QBOInvoiceResult = {
  qboId: string;
  qboSyncToken: string;
  qboUpdatedAt: Date;
  invoice: Invoice;
};

export type QBOPaymentResult = {
  qboId: string;
  qboSyncToken: string;
};

export interface QBOInvoicePort {
  getInvoice(qboId: string): Promise<QBOInvoiceResult>;
  createInvoice(
    invoice: Omit<Invoice, "id" | "createdAt" | "updatedAt">,
    ctx: QBOSyncContext
  ): Promise<QBOInvoiceResult>;
  updateInvoice(
    qboId: string,
    invoice: Partial<Invoice>,
    ctx: QBOSyncContext & { syncToken: string }
  ): Promise<QBOInvoiceResult>;
  voidInvoice(qboId: string, syncToken: string): Promise<QBOInvoiceResult>;
  findByDocNumber(docNumber: string): Promise<QBOInvoiceResult | null>;
  listInvoices(params: { limit: number; startPosition: number }): Promise<QBOInvoiceResult[]>;
}

export interface QBOPaymentPort {
  createPayment(
    payment: Payment,
    customerRef: string,
    qboInvoiceId: string
  ): Promise<QBOPaymentResult>;
  findByPaymentRefNum(refNum: string): Promise<QBOPaymentResult[]>;
}
