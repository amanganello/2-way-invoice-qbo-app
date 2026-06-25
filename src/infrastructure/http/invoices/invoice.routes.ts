import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { PrismaInvoiceRepository } from "../../database/invoice.repository.js";
import { createInvoice, updateInvoice } from "../../../application/invoices/invoice.use-cases.js";
import { CreateInvoiceSchema, UpdateInvoiceSchema, InvoiceParamsSchema } from "./invoice.schemas.js";

export async function registerInvoiceRoutes(app: FastifyInstance): Promise<void> {
  const repo = new PrismaInvoiceRepository();

  app.post("/invoices", async (request: FastifyRequest, reply: FastifyReply) => {
    const body = CreateInvoiceSchema.parse(request.body);
    const invoice = await createInvoice(body, repo);
    return reply.status(201).send(invoice);
  });

  app.patch("/invoices/:id", async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = InvoiceParamsSchema.parse(request.params);
    const body = UpdateInvoiceSchema.parse(request.body);
    const invoice = await updateInvoice(id, body, repo);
    return reply.status(200).send(invoice);
  });
}
