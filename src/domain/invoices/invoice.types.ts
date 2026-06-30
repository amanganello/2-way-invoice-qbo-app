export type InvoiceStatus = "draft" | "sent" | "paid" | "void" | "overdue";

export type InvoiceLineItem = {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  internalItemCode?: string;
  internalAccountCode?: string;
};

export type Invoice = {
  id: string;
  customerId: string;
  lineItems: InvoiceLineItem[];
  totalAmount: number;
  currency: string;
  status: InvoiceStatus;
  dueDate: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type Payment = {
  id: string;
  invoiceId: string;
  amount: number;
  currency: string;
  paidAt: Date;
};

export type PaymentInput = Omit<Payment, "id">;

export type QBOSyncContext = {
  customerRef: string;
  itemMap: Map<string, { qboItemId: string; taxCode: string }>;
  accountMap: Map<string, { qboAccountId: string }>;
  docNumber: string;
  syncToken?: string;
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

// Output ports — infrastructure must implement these

export interface InvoiceRepository {
  findById(id: string): Promise<Invoice | null>;
  save(invoice: Invoice): Promise<Invoice>;
}

export interface PaymentRepository {
  findById(id: string): Promise<Payment | null>;
  save(payment: Payment): Promise<Payment>;
  findByInvoiceId(invoiceId: string): Promise<Payment[]>;
}

export interface QBOInvoicePort {
  getInvoice(qboId: string): Promise<QBOInvoiceResult>;
  createInvoice(
    invoice: Omit<Invoice, "id" | "createdAt" | "updatedAt">,
    ctx: QBOSyncContext
  ): Promise<QBOInvoiceResult>;
  updateInvoice(
    qboId: string,
    invoice: Partial<Invoice>,
    ctx: Required<QBOSyncContext>
  ): Promise<QBOInvoiceResult>;
  voidInvoice(qboId: string, syncToken: string): Promise<QBOInvoiceResult>;
  findByDocNumber(docNumber: string): Promise<QBOInvoiceResult | null>;
}

export interface QBOPaymentPort {
  createPayment(
    payment: Payment,
    customerRef: string,
    qboInvoiceId: string
  ): Promise<QBOPaymentResult>;
  findByPaymentRefNum(refNum: string): Promise<QBOPaymentResult[]>;
}

export interface SyncQueuePort {
  enqueueReconcile(internalId: string): Promise<void>;
  enqueuePaymentSync(internalPaymentId: string): Promise<void>;
}
