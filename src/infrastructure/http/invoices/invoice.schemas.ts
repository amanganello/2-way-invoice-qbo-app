import { z } from "zod";
import {
  CurrencyCodeSchema,
  MoneySchema,
  type CurrencyCode,
  type InvoiceLineItem,
  type Money,
} from "@/domain/invoices/invoice.types.js";

type InvoiceBody = {
  customerId: string;
  lineItems: InvoiceLineItem[];
  totalAmount: Money;
  currency: CurrencyCode;
  status: "draft" | "sent" | "paid" | "void";
  dueDate: Date;
};

const LineItemSchema: z.ZodType<InvoiceLineItem, z.ZodTypeDef, unknown> = z.object({
  description: z.string().min(1),
  quantity: z.number().positive(),
  unitPrice: z.number().positive(),
  amount: z.number().positive(),
}).superRefine((line, ctx) => {
  const expected = Math.round(line.quantity * line.unitPrice * 100);
  const actual = Math.round(line.amount * 100);
  if (expected !== actual) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["amount"],
      message: "Line amount must equal quantity * unitPrice",
    });
  }
}).transform(line => ({
  ...line,
  unitPrice: MoneySchema.parse(line.unitPrice),
  amount: MoneySchema.parse(line.amount),
}));

const BaseInvoiceSchema = z.object({
  customerId: z.string().min(1),
  lineItems: z.array(LineItemSchema).min(1),
  totalAmount: z.number().positive(),
  currency: CurrencyCodeSchema.default("USD"),
  status: z.enum(["draft", "sent", "paid", "void"]).default("draft"),
  dueDate: z.coerce.date(),
});

export const CreateInvoiceSchema: z.ZodType<InvoiceBody, z.ZodTypeDef, unknown> = BaseInvoiceSchema.superRefine((invoice, ctx) => {
  const expected = Math.round(invoice.lineItems.reduce((sum, line) => (
    sum + Number(line.amount)
  ), 0) * 100);
  const actual = Math.round(invoice.totalAmount * 100);
  if (expected !== actual) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["totalAmount"],
      message: "Invoice totalAmount must equal sum of line item amounts",
    });
  }
}).transform(invoice => ({
  ...invoice,
  totalAmount: MoneySchema.parse(invoice.totalAmount),
}));

export const UpdateInvoiceSchema = BaseInvoiceSchema.partial()
  .refine(body => Object.keys(body).length > 0, { message: "PATCH body must not be empty" })
  .superRefine((invoice, ctx) => {
    if (!invoice.lineItems || invoice.totalAmount === undefined) return;
    const expected = Math.round(invoice.lineItems.reduce((sum, line) => (
      sum + Number(line.amount)
    ), 0) * 100);
    const actual = Math.round(invoice.totalAmount * 100);
    if (expected !== actual) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["totalAmount"],
        message: "Invoice totalAmount must equal sum of line item amounts",
      });
    }
  })
  .transform(invoice => ({
    ...invoice,
    ...(invoice.totalAmount !== undefined ? { totalAmount: MoneySchema.parse(invoice.totalAmount) } : {}),
  }));

export const InvoiceListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).optional(),
});

export const InvoiceParamsSchema = z.object({
  id: z.string().min(1),
});
