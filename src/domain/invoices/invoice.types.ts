import { z } from "zod";

declare const moneyBrand: unique symbol;
declare const currencyBrand: unique symbol;

export type Money = string & { readonly [moneyBrand]: "Money" };
export type CurrencyCode = string & { readonly [currencyBrand]: "CurrencyCode" };

export type InvoiceStatus = "draft" | "sent" | "paid" | "void" | "overdue";

export type InvoiceLineItem = {
  description: string;
  quantity: number;
  unitPrice: Money;
  amount: Money;
  internalItemCode?: string;
  internalAccountCode?: string;
};

export type Invoice = {
  id: string;
  customerId: string;
  lineItems: InvoiceLineItem[];
  totalAmount: Money;
  currency: CurrencyCode;
  status: InvoiceStatus;
  dueDate: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type Payment = {
  id: string;
  invoiceId: string;
  amount: Money;
  currency: CurrencyCode;
  paidAt: Date;
};

export type PaymentInput = Omit<Payment, "id">;

export const MoneySchema = z.union([z.string(), z.number()])
  .transform(value => Number(value).toFixed(2))
  .pipe(z.string().regex(/^-?\d+\.\d{2}$/))
  .transform(value => value as Money);

export const CurrencyCodeSchema = z.string()
  .regex(/^[A-Z]{3}$/)
  .transform(value => value as CurrencyCode);

export const InvoiceLineItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().positive(),
  unitPrice: MoneySchema,
  amount: MoneySchema,
  internalItemCode: z.string().min(1).optional(),
  internalAccountCode: z.string().min(1).optional(),
});

export function toMoney(value: string | number): Money {
  return MoneySchema.parse(value);
}

export function toCurrencyCode(value: string): CurrencyCode {
  return CurrencyCodeSchema.parse(value);
}

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

export interface SyncQueuePort {
  enqueueReconcile(internalId: string): Promise<void>;
  enqueuePaymentSync(internalPaymentId: string): Promise<void>;
}
