import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { PrismaInvoiceRepository } from "@/infrastructure/database/invoice.repository.js";
import { PrismaPaymentRepository } from "@/infrastructure/database/payment.repository.js";
import { createInvoice, updateInvoice } from "@/application/invoices/invoice.use-cases.js";
import { createPayment } from "@/application/invoices/payment.use-cases.js";
import { syncQueue } from "@/infrastructure/queue/queues.js";
import { CreateInvoiceSchema, UpdateInvoiceSchema, InvoiceParamsSchema } from "./invoice.schemas.js";
import { z } from "zod";

const CreatePaymentSchema = z.object({
  amount: z.number().positive().transform(n => n.toFixed(2)),
  currency: z.string().length(3).default("USD"),
  paidAt: z.coerce.date(),
});

export async function registerInvoiceRoutes(app: FastifyInstance): Promise<void> {
  const repo = new PrismaInvoiceRepository();
  const paymentRepo = new PrismaPaymentRepository();

  app.get("/invoices", async (_request: FastifyRequest, reply: FastifyReply) => {
    const invoices = await repo.findAll();
    return reply.status(200).send(invoices);
  });

  app.post("/invoices", async (request: FastifyRequest, reply: FastifyReply) => {
    const body = CreateInvoiceSchema.parse(request.body);
    const invoice = await createInvoice(body, repo, syncQueue);
    return reply.status(201).send(invoice);
  });

  app.patch("/invoices/:id", async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = InvoiceParamsSchema.parse(request.params);
    const body = UpdateInvoiceSchema.parse(request.body);
    const invoice = await updateInvoice(id, body, repo, syncQueue);
    return reply.status(200).send(invoice);
  });

  app.post("/invoices/:id/payments", async (request: FastifyRequest, reply: FastifyReply) => {
    const { id: invoiceId } = InvoiceParamsSchema.parse(request.params);
    const body = CreatePaymentSchema.parse(request.body);
    const payment = await createPayment(
      { ...body, invoiceId },
      paymentRepo,
      syncQueue
    );
    return reply.status(201).send(payment);
  });
}
