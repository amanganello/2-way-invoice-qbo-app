import type { Invoice, Payment } from "@/domain/invoices/invoice.types.js";

export interface InvoiceRepository {
  findById(id: string): Promise<Invoice | null>;
  save(invoice: Invoice): Promise<Invoice>;
}

export interface PaymentRepository {
  findById(id: string): Promise<Payment | null>;
  save(payment: Payment): Promise<Payment>;
  findByInvoiceId(invoiceId: string): Promise<Payment[]>;
}

export interface SyncQueuePort {
  enqueueReconcile(internalId: string): Promise<void>;
  enqueuePaymentSync(internalPaymentId: string): Promise<void>;
}
