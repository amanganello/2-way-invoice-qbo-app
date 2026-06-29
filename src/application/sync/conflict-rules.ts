import type { Invoice } from "@/domain/invoices/invoice.types.js";

export type ConflictRule = "internal" | "qbo" | "manual";
export type ConflictRulesMap = Partial<Record<keyof Invoice, ConflictRule>>;

export const conflictRules: ConflictRulesMap = {
  status: "qbo",
  lineItems: "internal",
  totalAmount: "qbo",
  currency: "internal",
  dueDate: "manual",
  customerId: "internal",
};
