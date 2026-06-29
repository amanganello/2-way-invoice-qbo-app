import type { Payment, PaymentInput, PaymentRepository, SyncQueuePort } from "@/domain/invoices/invoice.types.js";

export async function createPayment(
  data: PaymentInput,
  repo: PaymentRepository,
  syncQueue?: SyncQueuePort
): Promise<Payment> {
  const payment = await repo.save({
    ...data,
    id: crypto.randomUUID(),
  });
  await syncQueue?.enqueuePaymentSync(payment.id);
  return payment;
}
