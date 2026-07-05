import { MoneySchema, type Invoice, type InvoiceLineItem } from "@/domain/invoices/invoice.types.js";
import { conflictRules } from "./conflict-rules.js";

export type ConflictField = {
  field: keyof Invoice;
  internalValue: unknown;
  qboValue: unknown;
};

export type ConflictResult =
  | { hasConflict: false; mergedInvoice: Invoice }
  | { hasConflict: true; conflictedFields: ConflictField[]; internalInvoice: Invoice; qboInvoice: Invoice };

const TRACKED_FIELDS: (keyof Invoice)[] = [
  "customerId", "lineItems", "totalAmount", "currency", "status", "dueDate",
];

type FieldComparator<K extends keyof Invoice> = (a: Invoice[K], b: Invoice[K]) => boolean;
type FieldComparators = { [K in keyof Invoice]?: FieldComparator<K> };

const comparators: FieldComparators = {
  customerId: (a, b) => a === b,
  totalAmount: (a, b) => normalizeMoney(a) === normalizeMoney(b),
  currency: (a, b) => a === b,
  status: (a, b) => a === b,
  dueDate: (a, b) => normalizeDate(a) === normalizeDate(b),
  lineItems: (a, b) => JSON.stringify(normalizeLineItems(a)) === JSON.stringify(normalizeLineItems(b)),
};

function equal<K extends keyof Invoice>(field: K, a: Invoice[K], b: Invoice[K]): boolean {
  const comparator = comparators[field] as FieldComparator<K> | undefined;
  return comparator ? comparator(a, b) : Object.is(a, b);
}

function normalizeMoney(value: unknown): string {
  return MoneySchema.parse(value);
}

function normalizeDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function normalizeLineItems(items: InvoiceLineItem[]): Array<Record<string, unknown>> {
  return items.map(item => ({
    description: item.description,
    quantity: item.quantity,
    unitPrice: normalizeMoney(item.unitPrice),
    amount: normalizeMoney(item.amount),
    ...(item.internalItemCode ? { internalItemCode: item.internalItemCode } : {}),
    ...(item.internalAccountCode ? { internalAccountCode: item.internalAccountCode } : {}),
  }));
}

export function detectConflicts(
  snapshot: Invoice,
  internalInvoice: Invoice,
  qboInvoice: Invoice
): ConflictResult {
  const mergedInvoice = { ...internalInvoice };
  const conflictedFields: ConflictField[] = [];

  for (const field of TRACKED_FIELDS) {
    const qboChanged = !equal(field, qboInvoice[field], snapshot[field]);
    const internalChanged = !equal(field, internalInvoice[field], snapshot[field]);

    if (!qboChanged && !internalChanged) continue;

    if (qboChanged && !internalChanged) {
      (mergedInvoice as Record<string, unknown>)[field] = qboInvoice[field];
      continue;
    }

    if (!qboChanged && internalChanged) continue; // keep internal (already in merged)

    // Both changed — apply rule
    const rule = conflictRules[field];
    if (rule === "internal") {
      // keep internal (already in merged)
    } else if (rule === "qbo") {
      (mergedInvoice as Record<string, unknown>)[field] = qboInvoice[field];
    } else {
      conflictedFields.push({ field, internalValue: internalInvoice[field], qboValue: qboInvoice[field] });
    }
  }

  if (conflictedFields.length > 0) {
    return { hasConflict: true, conflictedFields, internalInvoice, qboInvoice };
  }
  return { hasConflict: false, mergedInvoice };
}
