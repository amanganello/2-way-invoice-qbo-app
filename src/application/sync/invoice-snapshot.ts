import { z } from "zod";
import {
  CurrencyCodeSchema,
  MoneySchema,
  type CurrencyCode,
  type Invoice,
  type InvoiceLineItem,
  type InvoiceStatus,
  type Money,
} from "@/domain/invoices/invoice.types.js";

export type InvoiceLineItemSnapshot = {
  description: string;
  quantity: number;
  unitPrice: Money;
  amount: Money;
  internalItemCode?: string;
  internalAccountCode?: string;
};

export type InvoiceSnapshot = {
  customerId: string;
  lineItems: InvoiceLineItemSnapshot[];
  totalAmount: Money;
  currency: CurrencyCode;
  status: InvoiceStatus;
  dueDate: string;
};

export const InvoiceLineItemSnapshotSchema: z.ZodType<InvoiceLineItemSnapshot, z.ZodTypeDef, unknown> = z.object({
  description: z.string(),
  quantity: z.number(),
  unitPrice: MoneySchema,
  amount: MoneySchema,
  internalItemCode: z.string().optional(),
  internalAccountCode: z.string().optional(),
});

export const InvoiceSnapshotSchema: z.ZodType<InvoiceSnapshot, z.ZodTypeDef, unknown> = z.object({
  customerId: z.string(),
  lineItems: z.array(InvoiceLineItemSnapshotSchema),
  totalAmount: MoneySchema,
  currency: CurrencyCodeSchema,
  status: z.enum(["draft", "sent", "paid", "void", "overdue"]),
  dueDate: z.union([z.string(), z.date()]).transform(value => (
    value instanceof Date ? value.toISOString() : value
  )),
});

export function invoiceToSnapshot(invoice: Invoice): Record<string, unknown> {
  return {
    customerId: invoice.customerId,
    lineItems: invoice.lineItems,
    totalAmount: invoice.totalAmount,
    currency: invoice.currency,
    status: invoice.status,
    dueDate: invoice.dueDate.toISOString(),
  };
}

export function parseInvoiceSnapshot(snapshot: unknown): InvoiceSnapshot {
  return InvoiceSnapshotSchema.parse(snapshot);
}

export function snapshotToInvoice(snapshot: unknown, base: Invoice): Invoice {
  const parsed = parseInvoiceSnapshot(snapshot);
  return {
    ...base,
    customerId: parsed.customerId,
    lineItems: parsed.lineItems.map((li): InvoiceLineItem => ({
      description: li.description,
      quantity: li.quantity,
      unitPrice: li.unitPrice,
      amount: li.amount,
      ...(li.internalItemCode ? { internalItemCode: li.internalItemCode } : {}),
      ...(li.internalAccountCode ? { internalAccountCode: li.internalAccountCode } : {}),
    })),
    totalAmount: parsed.totalAmount,
    currency: parsed.currency,
    status: parsed.status as InvoiceStatus,
    dueDate: new Date(parsed.dueDate),
  };
}
