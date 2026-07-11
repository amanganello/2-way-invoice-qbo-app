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

export const toMoney = (value: string | number): Money => MoneySchema.parse(value);

export const toCurrencyCode = (value: string): CurrencyCode => CurrencyCodeSchema.parse(value);
