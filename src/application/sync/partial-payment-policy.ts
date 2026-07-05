import type { Invoice } from "@/domain/invoices/invoice.types.js";
import type { PaymentSyncLinkPort } from "@/application/ports/sync.ports.js";
import { ConflictError } from "@/shared/errors/app-error.js";
import { parseInvoiceSnapshot } from "./invoice-snapshot.js";

export class PartialPaymentPolicy {
  constructor(private readonly paymentSyncLinkRepo: PaymentSyncLinkPort) {}

  async assertEditable(invoice: Invoice, lastSyncedSnapshot: Record<string, unknown> | null): Promise<void> {
    if (!lastSyncedSnapshot) return;

    const payments = await this.paymentSyncLinkRepo.findByInvoiceInternalId(invoice.id);
    if (payments.length === 0) return;

    const snapshot = parseInvoiceSnapshot(lastSyncedSnapshot);
    const lineItemsChanged =
      JSON.stringify(normalizeLineItems(invoice.lineItems)) !==
      JSON.stringify(normalizeLineItems(snapshot.lineItems));
    const totalAmountChanged = invoice.totalAmount !== Number(snapshot.totalAmount).toFixed(2);

    if (lineItemsChanged || totalAmountChanged) {
      throw new ConflictError(
        `Invoice ${invoice.id} has ${payments.length} linked payment(s); ` +
        "lineItems and totalAmount cannot be modified on a partially-paid invoice"
      );
    }
  }
}

function normalizeLineItems(items: unknown): unknown {
  return Array.isArray(items)
    ? (items as Array<{ unitPrice: number | string; amount: number | string; [key: string]: unknown }>)
        .map(item => ({
          ...item,
          unitPrice: Number(item.unitPrice).toFixed(2),
          amount: Number(item.amount).toFixed(2),
        }))
    : items;
}
