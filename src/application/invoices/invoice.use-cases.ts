import type { Invoice, InvoiceRepository } from "../../domain/invoices/invoice.types.js";
import { NotFoundError } from "../../shared/errors/app-error.js";

export type CreateInvoiceInput = Omit<Invoice, "id" | "createdAt" | "updatedAt">;
export type UpdateInvoiceInput = Partial<CreateInvoiceInput>;

export async function createInvoice(
  data: CreateInvoiceInput,
  repo: InvoiceRepository
): Promise<Invoice> {
  return repo.save({
    ...data,
    id: crypto.randomUUID(),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

export async function updateInvoice(
  id: string,
  data: UpdateInvoiceInput,
  repo: InvoiceRepository
): Promise<Invoice> {
  const existing = await repo.findById(id);
  if (!existing) throw new NotFoundError(`Invoice ${id} not found`);

  return repo.save({
    ...existing,
    ...data,
    id,
    updatedAt: new Date(),
  });
}
