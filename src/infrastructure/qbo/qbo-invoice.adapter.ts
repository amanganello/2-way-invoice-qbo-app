import type {
  Invoice, QBOInvoicePort, QBOSyncContext, QBOInvoiceResult, InvoiceStatus,
} from "@/domain/invoices/invoice.types.js";
import { qboClient } from "./qbo.client.js";
import type { QBOInvoiceEntity, QBOLine } from "./qbo.types.js";

type InvoiceResponse = { Invoice: QBOInvoiceEntity };
type QueryResponse = { QueryResponse: { Invoice?: QBOInvoiceEntity[]; maxResults?: number } };

function buildLines(
  lineItems: Invoice["lineItems"],
  itemMap: QBOSyncContext["itemMap"]
): QBOLine[] {
  return lineItems.map((li) => {
    const mapping = li.internalItemCode ? itemMap.get(li.internalItemCode) : undefined;
    return {
      Amount: li.amount,
      DetailType: "SalesItemLineDetail",
      Description: li.description,
      SalesItemLineDetail: {
        ItemRef: { value: mapping?.qboItemId ?? "1" },
        TaxCodeRef: { value: mapping?.taxCode ?? "NON" },
        Qty: li.quantity,
        UnitPrice: li.unitPrice,
      },
    };
  });
}

function toResult(entity: QBOInvoiceEntity, fallbackInvoice?: Partial<Invoice>): QBOInvoiceResult {
  const invoice: Invoice = {
    id: entity.DocNumber ?? "",
    customerId: entity.CustomerRef.value,
    lineItems: (entity.Line ?? [])
      .filter(l => l.DetailType === "SalesItemLineDetail")
      .map(l => ({
        description: l.Description ?? "",
        quantity: l.SalesItemLineDetail?.Qty ?? 1,
        unitPrice: l.SalesItemLineDetail?.UnitPrice ?? l.Amount,
        amount: l.Amount,
      })),
    totalAmount: entity.TotalAmt ?? 0,
    currency: entity.CurrencyRef?.value ?? "USD",
    status: "sent" as InvoiceStatus,
    dueDate: entity.DueDate ? new Date(entity.DueDate) : new Date(),
    createdAt: entity.MetaData ? new Date(entity.MetaData.CreateTime) : new Date(),
    updatedAt: entity.MetaData ? new Date(entity.MetaData.LastUpdatedTime) : new Date(),
    ...fallbackInvoice,
  };
  return {
    qboId: entity.Id!,
    qboSyncToken: entity.SyncToken!,
    qboUpdatedAt: entity.MetaData ? new Date(entity.MetaData.LastUpdatedTime) : new Date(),
    invoice,
  };
}

export class QBOInvoiceAdapter implements QBOInvoicePort {
  async getInvoice(qboId: string): Promise<QBOInvoiceResult> {
    const res = await qboClient.request<InvoiceResponse>(
      "GET",
      `/invoice/${qboId}?minorversion=65`
    );
    return toResult(res.Invoice);
  }

  async createInvoice(
    invoice: Omit<Invoice, "id" | "createdAt" | "updatedAt">,
    ctx: QBOSyncContext
  ): Promise<QBOInvoiceResult> {
    const payload: QBOInvoiceEntity = {
      CustomerRef: { value: ctx.customerRef },
      DocNumber: ctx.docNumber,
      Line: buildLines(invoice.lineItems, ctx.itemMap),
      DueDate: invoice.dueDate.toISOString().split("T")[0],
      CurrencyRef: { value: invoice.currency },
    };
    const res = await qboClient.request<InvoiceResponse>("POST", "/invoice?minorversion=65", payload);
    return toResult(res.Invoice);
  }

  async updateInvoice(
    qboId: string,
    invoice: Partial<Invoice>,
    ctx: Required<QBOSyncContext>
  ): Promise<QBOInvoiceResult> {
    const payload: QBOInvoiceEntity = {
      Id: qboId,
      SyncToken: ctx.syncToken,
      CustomerRef: { value: ctx.customerRef },
      DocNumber: ctx.docNumber,
      ...(invoice.lineItems && { Line: buildLines(invoice.lineItems, ctx.itemMap) }),
      ...(invoice.dueDate && { DueDate: invoice.dueDate.toISOString().split("T")[0] }),
      ...(invoice.currency && { CurrencyRef: { value: invoice.currency } }),
    };
    const res = await qboClient.request<InvoiceResponse>(
      "POST",
      "/invoice?operation=update&minorversion=65",
      payload
    );
    return toResult(res.Invoice);
  }

  async voidInvoice(qboId: string, syncToken: string): Promise<QBOInvoiceResult> {
    const payload = { Id: qboId, SyncToken: syncToken, sparse: true };
    const res = await qboClient.request<InvoiceResponse>(
      "POST",
      "/invoice?operation=void&minorversion=65",
      payload
    );
    return toResult(res.Invoice);
  }

  async findByDocNumber(docNumber: string): Promise<QBOInvoiceResult | null> {
    const res = await qboClient.request<QueryResponse>(
      "GET",
      `/query?query=${encodeURIComponent(`SELECT * FROM Invoice WHERE DocNumber = '${docNumber}'`)}&minorversion=65`
    );
    const invoices = res.QueryResponse.Invoice;
    if (!invoices?.length) return null;
    return toResult(invoices[0]);
  }
}
