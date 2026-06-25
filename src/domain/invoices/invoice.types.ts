export type InvoiceStatus = "draft" | "sent" | "paid" | "void" | "overdue";

export type InvoiceLineItem = {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
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

// Output ports — infrastructure must implement these

export interface InvoiceRepository {
  findById(id: string): Promise<Invoice | null>;
  save(invoice: Invoice): Promise<Invoice>;
  delete(id: string): Promise<void>;
}

export interface QBOInvoicePort {
  getInvoice(id: string): Promise<Invoice>;
  createInvoice(
    data: Omit<Invoice, "id" | "createdAt" | "updatedAt">
  ): Promise<Invoice>;
  updateInvoice(id: string, data: Partial<Invoice>): Promise<Invoice>;
  voidInvoice(id: string): Promise<void>;
}

export interface QBOPaymentPort {
  getPayment(id: string): Promise<Payment>;
  createPayment(data: PaymentInput): Promise<Payment>;
}
