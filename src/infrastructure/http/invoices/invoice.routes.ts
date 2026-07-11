import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { PrismaInvoiceRepository } from "@/infrastructure/database/invoice.repository.js";
import { PrismaPaymentRepository } from "@/infrastructure/database/payment.repository.js";
import { createInvoice, updateInvoice } from "@/application/invoices/invoice.use-cases.js";
import { createPayment } from "@/application/invoices/payment.use-cases.js";
import { syncQueue } from "@/infrastructure/queue/queues.js";
import { CreateInvoiceSchema, UpdateInvoiceSchema, InvoiceParamsSchema, InvoiceListQuerySchema } from "./invoice.schemas.js";
import { CurrencyCodeSchema, MoneySchema, type Invoice } from "@/domain/invoices/invoice.types.js";
import type { InvoiceRepository, PaymentRepository, SyncQueuePort } from "@/application/ports/invoice.ports.js";
import { z } from "zod";

const CreatePaymentSchema = z.object({
  amount: z.number().positive().transform(n => MoneySchema.parse(n)),
  currency: CurrencyCodeSchema.default("USD"),
  paidAt: z.coerce.date(),
});

type InvoiceListRepository = InvoiceRepository & {
  findAll(params?: { limit?: number; cursor?: string }): Promise<Invoice[]>;
};

export type InvoiceRouteDeps = {
  invoiceRepo: InvoiceListRepository;
  paymentRepo: PaymentRepository;
  syncQueue: SyncQueuePort;
};

export const defaultInvoiceRouteDeps: InvoiceRouteDeps = {
  invoiceRepo: new PrismaInvoiceRepository(),
  paymentRepo: new PrismaPaymentRepository(),
  syncQueue,
};

export async function registerInvoiceRoutes(
  app: FastifyInstance,
  deps: InvoiceRouteDeps = defaultInvoiceRouteDeps
): Promise<void> {
  app.get("/invoices", async (request: FastifyRequest, reply: FastifyReply) => {
    const query = InvoiceListQuerySchema.parse(request.query);
    const invoices = await deps.invoiceRepo.findAll(query);
    return reply.status(200).send(invoices);
  });

  app.post("/invoices", async (request: FastifyRequest, reply: FastifyReply) => {
    const body = CreateInvoiceSchema.parse(request.body);
    const invoice = await createInvoice(body, deps.invoiceRepo, deps.syncQueue);
    return reply.status(201).send(invoice);
  });

  app.patch("/invoices/:id", async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = InvoiceParamsSchema.parse(request.params);
    const body = UpdateInvoiceSchema.parse(request.body);
    const invoice = await updateInvoice(id, body, deps.invoiceRepo, deps.syncQueue);
    return reply.status(200).send(invoice);
  });

  app.post("/invoices/:id/payments", async (request: FastifyRequest, reply: FastifyReply) => {
    const { id: invoiceId } = InvoiceParamsSchema.parse(request.params);
    const body = CreatePaymentSchema.parse(request.body);
    const payment = await createPayment(
      { ...body, invoiceId },
      deps.paymentRepo,
      deps.syncQueue
    );
    return reply.status(201).send(payment);
  });
}
