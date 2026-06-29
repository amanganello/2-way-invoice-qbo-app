import type { Invoice, InvoiceRepository, SyncQueuePort } from "@/domain/invoices/invoice.types.js";
import { NotFoundError } from "@/shared/errors/app-error.js";

export type CreateInvoiceInput = Omit<Invoice, "id" | "createdAt" | "updatedAt">;
export type UpdateInvoiceInput = Partial<CreateInvoiceInput>;

export async function createInvoice(
  data: CreateInvoiceInput,
  repo: InvoiceRepository,
  syncQueue?: SyncQueuePort
): Promise<Invoice> {
  const invoice = await repo.save({
    ...data,
    id: crypto.randomUUID(),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await syncQueue?.enqueueReconcile(invoice.id);
  return invoice;
}

export async function updateInvoice(
  id: string,
  data: UpdateInvoiceInput,
  repo: InvoiceRepository,
  syncQueue?: SyncQueuePort
): Promise<Invoice> {
  const existing = await repo.findById(id);
  if (!existing) throw new NotFoundError(`Invoice ${id} not found`);

  const invoice = await repo.save({
    ...existing,
    ...data,
    id,
    updatedAt: new Date(),
  });
  await syncQueue?.enqueueReconcile(invoice.id);
  return invoice;
}
