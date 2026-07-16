import type { Payment, PaymentInput } from "@/domain/invoices/invoice.types.js";
import type { PaymentRepository, SyncQueuePort } from "@/application/ports/invoice.ports.js";

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
