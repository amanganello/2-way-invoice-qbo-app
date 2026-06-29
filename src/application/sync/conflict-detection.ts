import type { Invoice } from "@/domain/invoices/invoice.types.js";
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

function equal(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function detectConflicts(
  snapshot: Invoice,
  internalInvoice: Invoice,
  qboInvoice: Invoice
): ConflictResult {
  const mergedInvoice = { ...internalInvoice };
  const conflictedFields: ConflictField[] = [];

  for (const field of TRACKED_FIELDS) {
    const qboChanged = !equal(qboInvoice[field], snapshot[field]);
    const internalChanged = !equal(internalInvoice[field], snapshot[field]);

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
