import { z } from "zod";

const LineItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().positive(),
  unitPrice: z.number().positive(),
  amount: z.number().positive(),
});

export const CreateInvoiceSchema = z.object({
  customerId: z.string().min(1),
  lineItems: z.array(LineItemSchema).min(1),
  totalAmount: z.number().positive(),
  currency: z.string().length(3).default("USD"),
  status: z.enum(["draft", "sent", "paid", "void"]).default("draft"),
  dueDate: z.coerce.date(),
});

export const UpdateInvoiceSchema = CreateInvoiceSchema.partial();

export const InvoiceParamsSchema = z.object({
  id: z.string().min(1),
});
