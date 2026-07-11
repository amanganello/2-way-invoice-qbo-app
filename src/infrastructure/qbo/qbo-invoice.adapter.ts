import type { Invoice, InvoiceStatus } from "@/domain/invoices/invoice.types.js";
import { CurrencyCodeSchema, MoneySchema } from "@/domain/invoices/invoice.types.js";
import type { QBOInvoicePort, QBOSyncContext, QBOInvoiceResult } from "@/application/ports/qbo.ports.js";
import { NotFoundError } from "@/shared/errors/app-error.js";
import { qboClient } from "./qbo.client.js";
import type { QBOInvoiceEntity, QBOLine } from "./qbo.types.js";
import { z } from "zod";

type InvoiceResponse = { Invoice: QBOInvoiceEntity };
type QueryResponse = { QueryResponse: { Invoice?: QBOInvoiceEntity[]; maxResults?: number } };

const QBORefSchema = z.object({ value: z.string(), name: z.string().optional() });
const QBOLineSchema = z.object({
  Id: z.string().optional(),
  LineNum: z.number().optional(),
  Amount: z.number(),
  DetailType: z.string(),
  SalesItemLineDetail: z.object({
    ItemRef: QBORefSchema,
    AccountRef: z.object({ value: z.string() }).optional(),
    TaxCodeRef: z.object({ value: z.string() }).optional(),
    Qty: z.number().optional(),
    UnitPrice: z.number().optional(),
  }).optional(),
  SubTotalLineDetail: z.unknown().optional(),
  Description: z.string().optional(),
}).passthrough();
const QBOInvoiceEntitySchema = z.object({
  Id: z.string().optional(),
  SyncToken: z.string().optional(),
  DocNumber: z.string().optional(),
  CustomerRef: QBORefSchema,
  Line: z.array(QBOLineSchema).optional(),
  TotalAmt: z.number().optional(),
  Balance: z.number().optional(),
  DueDate: z.string().optional(),
  CurrencyRef: z.object({ value: z.string() }).optional(),
  PrivateNote: z.string().optional(),
  MetaData: z.object({ CreateTime: z.string(), LastUpdatedTime: z.string() }).optional(),
}) satisfies z.ZodType<QBOInvoiceEntity>;
const InvoiceResponseSchema = z.object({ Invoice: QBOInvoiceEntitySchema });
const QueryResponseSchema = z.object({
  QueryResponse: z.object({
    Invoice: z.array(QBOInvoiceEntitySchema).optional(),
    maxResults: z.number().optional(),
  }),
});

function buildLines(
  lineItems: Invoice["lineItems"],
  itemMap: QBOSyncContext["itemMap"],
  accountMap?: QBOSyncContext["accountMap"],
  defaultItemId?: string
): QBOLine[] {
  return lineItems.map((li) => {
    const mapping = li.internalItemCode ? itemMap.get(li.internalItemCode) : undefined;
    if (li.internalItemCode && !mapping) {
      throw new NotFoundError(`ItemMap missing for internal code: ${li.internalItemCode}`);
    }

    const accountMapping = li.internalAccountCode
      ? accountMap?.get(li.internalAccountCode)
      : undefined;
    if (li.internalAccountCode && !accountMapping) {
      throw new NotFoundError(`AccountMap missing for code: ${li.internalAccountCode}`);
    }

    const itemId = mapping?.qboItemId ?? defaultItemId;
    if (!itemId) {
      throw new NotFoundError(
        `No ItemMap entry for line item "${li.description}" and QB_DEFAULT_ITEM_ID is not set`
      );
    }

    const unitPrice = parseFloat(li.unitPrice);
    const qty = li.quantity;
    // QBO validates Amount === UnitPrice × Qty — derive it rather than trusting li.amount
    const amount = Math.round(unitPrice * qty * 100) / 100;

    return {
      Amount: amount,
      DetailType: "SalesItemLineDetail",
      Description: li.description,
      SalesItemLineDetail: {
        ItemRef: { value: itemId },
        ...(accountMapping && { AccountRef: { value: accountMapping.qboAccountId } }),
        TaxCodeRef: { value: mapping?.taxCode ?? "NON" },
        Qty: qty,
        UnitPrice: unitPrice,
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
        description: l.Description?.trim() || "(no description)",
        quantity: l.SalesItemLineDetail?.Qty ?? 1,
        unitPrice: MoneySchema.parse(Number(l.SalesItemLineDetail?.UnitPrice ?? l.Amount).toFixed(2)),
        amount: MoneySchema.parse(Number(l.Amount).toFixed(2)),
      })),
    totalAmount: MoneySchema.parse(Number(entity.TotalAmt ?? 0).toFixed(2)),
    currency: CurrencyCodeSchema.parse(entity.CurrencyRef?.value ?? "USD"),
    // QBO has no explicit status enum. Derive internal status from available fields:
    // - No line items AND TotalAmt === 0 → invoice was voided via the void API
    // - DocNumber absent or empty → invoice is still a draft in QBO
    // - Otherwise → sent/posted
    status: (
      (!entity.Line?.length && (entity.TotalAmt ?? 0) === 0)
        ? "void"
        : (!entity.DocNumber ? "draft" : "sent")
    ) as InvoiceStatus,
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
      `/invoice/${qboId}?minorversion=65`,
      undefined,
      json => InvoiceResponseSchema.parse(json)
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
      Line: buildLines(invoice.lineItems, ctx.itemMap, ctx.accountMap, ctx.defaultItemId),
      DueDate: invoice.dueDate.toISOString().split("T")[0],
      CurrencyRef: { value: invoice.currency },
    };
    const res = await qboClient.request<InvoiceResponse>(
      "POST",
      "/invoice?minorversion=65",
      payload,
      json => InvoiceResponseSchema.parse(json)
    );
    return toResult(res.Invoice);
  }

  async updateInvoice(
    qboId: string,
    invoice: Partial<Invoice>,
    ctx: QBOSyncContext & { syncToken: string }
  ): Promise<QBOInvoiceResult> {
    const payload: QBOInvoiceEntity = {
      Id: qboId,
      SyncToken: ctx.syncToken,
      CustomerRef: { value: ctx.customerRef },
      DocNumber: ctx.docNumber,
      ...(invoice.lineItems && { Line: buildLines(invoice.lineItems, ctx.itemMap, ctx.accountMap, ctx.defaultItemId) }),
      ...(invoice.dueDate && { DueDate: invoice.dueDate.toISOString().split("T")[0] }),
      ...(invoice.currency && { CurrencyRef: { value: invoice.currency } }),
    };
    const res = await qboClient.request<InvoiceResponse>(
      "POST",
      "/invoice?operation=update&minorversion=65",
      payload,
      json => InvoiceResponseSchema.parse(json)
    );
    return toResult(res.Invoice);
  }

  async voidInvoice(qboId: string, syncToken: string): Promise<QBOInvoiceResult> {
    const payload = { Id: qboId, SyncToken: syncToken, sparse: true };
    const res = await qboClient.request<InvoiceResponse>(
      "POST",
      "/invoice?operation=void&minorversion=65",
      payload,
      json => InvoiceResponseSchema.parse(json)
    );
    return toResult(res.Invoice);
  }

  async findByDocNumber(docNumber: string): Promise<QBOInvoiceResult | null> {
    const res = await qboClient.request<QueryResponse>(
      "GET",
      `/query?query=${encodeURIComponent(`SELECT * FROM Invoice WHERE DocNumber = '${docNumber}'`)}&minorversion=65`,
      undefined,
      json => QueryResponseSchema.parse(json)
    );
    const invoices = res.QueryResponse.Invoice;
    if (!invoices?.length) return null;
    return toResult(invoices[0]);
  }

  async listInvoices(params: { limit: number; startPosition: number }): Promise<QBOInvoiceResult[]> {
    const res = await qboClient.request<QueryResponse>(
      "GET",
      `/query?query=${encodeURIComponent(`SELECT * FROM Invoice STARTPOSITION ${params.startPosition} MAXRESULTS ${params.limit}`)}&minorversion=65`,
      undefined,
      json => QueryResponseSchema.parse(json)
    );
    return (res.QueryResponse.Invoice ?? []).map(entity => toResult(entity));
  }
}
