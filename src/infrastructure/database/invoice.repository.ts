import { InvoiceStatus as PrismaInvoiceStatus, type Invoice as PrismaInvoice, type Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";
import {
  CurrencyCodeSchema,
  InvoiceLineItemSchema,
  MoneySchema,
  type Invoice,
  type InvoiceRepository,
  type InvoiceStatus,
} from "../../domain/invoices/invoice.types.js";

const STATUS_TO_PRISMA: Record<InvoiceStatus, PrismaInvoiceStatus> = {
  draft: PrismaInvoiceStatus.DRAFT,
  sent: PrismaInvoiceStatus.SENT,
  paid: PrismaInvoiceStatus.PAID,
  void: PrismaInvoiceStatus.VOID,
  overdue: PrismaInvoiceStatus.OVERDUE,
};

const STATUS_TO_DOMAIN: Record<PrismaInvoiceStatus, InvoiceStatus> = {
  DRAFT: "draft",
  SENT: "sent",
  PAID: "paid",
  VOID: "void",
  OVERDUE: "overdue",
};

function toDomain(row: PrismaInvoice): Invoice {
  const lineItems = InvoiceLineItemSchema.array().parse(row.lineItems);
  return {
    id: row.id,
    customerId: row.customerId,
    lineItems,
    totalAmount: MoneySchema.parse(row.totalAmount.toFixed(2)),
    currency: CurrencyCodeSchema.parse(row.currency),
    status: STATUS_TO_DOMAIN[row.status],
    dueDate: row.dueDate,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PrismaInvoiceRepository implements InvoiceRepository {
  async findById(id: string): Promise<Invoice | null> {
    const row = await prisma.invoice.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findAll(params: { limit?: number; cursor?: string } = {}): Promise<Invoice[]> {
    const rows = await prisma.invoice.findMany({
      orderBy: { createdAt: "desc" },
      take: params.limit ?? 50,
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
    });
    return rows.map(toDomain);
  }

  async save(invoice: Invoice): Promise<Invoice> {
    const data = {
      customerId: invoice.customerId,
      lineItems: invoice.lineItems as Prisma.InputJsonValue,
      totalAmount: invoice.totalAmount,
      currency: invoice.currency,
      status: STATUS_TO_PRISMA[invoice.status],
      dueDate: invoice.dueDate,
    };

    const row = await prisma.invoice.upsert({
      where: { id: invoice.id },
      create: { id: invoice.id, ...data },
      update: data,
    });

    return toDomain(row);
  }

}
