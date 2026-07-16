import type { Invoice } from "@/domain/invoices/invoice.types.js";
import type { QBOSyncContext } from "@/application/ports/qbo.ports.js";
import type { AccountMapPort, CustomerMapPort, ItemMapPort } from "@/application/ports/sync.ports.js";
import { ExternalServiceError } from "@/shared/errors/app-error.js";

export type ResolvedQboSyncContext = QBOSyncContext;

export type QboSyncContextResolverDeps = {
  accountMapRepo: AccountMapPort;
  itemMapRepo: ItemMapPort;
  customerMapRepo: CustomerMapPort;
  qbDefaultCustomerId?: string;
  qbDefaultItemId?: string;
  qbEnvironment: string;
};

export class QboSyncContextResolver {
  constructor(private readonly deps: QboSyncContextResolverDeps) {}

  async resolve(invoice: Invoice): Promise<ResolvedQboSyncContext> {
    const customerRef = await this.resolveCustomerRef(invoice.customerId);
    const [itemMap, accountMap] = await Promise.all([
      this.resolveItemMap(invoice),
      this.resolveAccountMap(invoice),
    ]);

    return {
      customerRef,
      itemMap,
      accountMap,
      docNumber: invoice.id.replace(/-/g, "").slice(0, 20),
      defaultItemId: this.deps.qbDefaultItemId,
    };
  }

  private async resolveCustomerRef(customerId: string): Promise<string> {
    const customerEntry = await this.deps.customerMapRepo.findByInternalId(customerId);
    if (customerEntry) return customerEntry.qboCustomerId;
    if (this.deps.qbEnvironment === "sandbox" && this.deps.qbDefaultCustomerId) {
      return this.deps.qbDefaultCustomerId;
    }
    throw new ExternalServiceError(`No CustomerMap entry for customer: ${customerId}`);
  }

  private async resolveItemMap(invoice: Invoice): Promise<QBOSyncContext["itemMap"]> {
    const codes = [...new Set(
      invoice.lineItems
        .map(line => line.internalItemCode)
        .filter((code): code is string => Boolean(code))
    )];

    const entries = await Promise.all(
      codes.map(async (code) => {
        const entry = await this.deps.itemMapRepo.findByInternalCode(code);
        if (!entry) throw new ExternalServiceError(`No ItemMap entry for code: ${code}`);
        return [code, { qboItemId: entry.qboItemId, taxCode: entry.defaultTaxCode }] as const;
      })
    );

    return new Map(entries);
  }

  private async resolveAccountMap(invoice: Invoice): Promise<QBOSyncContext["accountMap"]> {
    const codes = [...new Set(
      invoice.lineItems
        .map(line => line.internalAccountCode)
        .filter((code): code is string => Boolean(code))
    )];

    const entries = await Promise.all(
      codes.map(async (code) => {
        const entry = await this.deps.accountMapRepo.findByInternalCode(code);
        if (!entry) throw new ExternalServiceError(`No AccountMap entry for code: ${code}`);
        return [code, { qboAccountId: entry.qboAccountId }] as const;
      })
    );

    return new Map(entries);
  }
}
