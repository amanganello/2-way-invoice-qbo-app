import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";
import { CurrencyCodeSchema, MoneySchema, type Payment, type PaymentRepository } from "@/domain/invoices/invoice.types.js";

function toDomain(row: { id: string; invoiceId: string; amount: Prisma.Decimal; currency: string; paidAt: Date; createdAt: Date; updatedAt: Date }): Payment {
  return {
    id: row.id,
    invoiceId: row.invoiceId,
    amount: MoneySchema.parse(row.amount.toFixed(2)),
    currency: CurrencyCodeSchema.parse(row.currency),
    paidAt: row.paidAt,
  };
}

export class PrismaPaymentRepository implements PaymentRepository {
  async findById(id: string): Promise<Payment | null> {
    const row = await prisma.payment.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async save(payment: Payment): Promise<Payment> {
    const row = await prisma.payment.upsert({
      where: { id: payment.id },
      create: {
        id: payment.id,
        invoiceId: payment.invoiceId,
        amount: payment.amount,
        currency: payment.currency,
        paidAt: payment.paidAt,
      },
      update: {
        amount: payment.amount,
        currency: payment.currency,
        paidAt: payment.paidAt,
      },
    });
    return toDomain(row);
  }

  async findByInvoiceId(invoiceId: string): Promise<Payment[]> {
    const rows = await prisma.payment.findMany({ where: { invoiceId } });
    return rows.map(toDomain);
  }
}
