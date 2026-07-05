import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "@/app";

describe("Invoice routes", () => {
  let app: FastifyInstance;

  const mockRepo = {
    save: vi.fn(async (invoice: unknown) => invoice),
    findById: vi.fn(async (id: string) =>
      id === "inv-1"
        ? {
            id,
            customerId: "cust-1",
            lineItems: [],
            totalAmount: "100.00",
            currency: "USD",
            status: "draft",
            dueDate: new Date("2030-01-01"),
            createdAt: new Date("2030-01-01"),
            updatedAt: new Date("2030-01-01"),
          }
        : null
    ),
  };

  beforeAll(async () => {
    // Apply mock BEFORE importing route registration module.
    vi.doMock(
      "@/infrastructure/database/invoice.repository.js",
      () => ({
        PrismaInvoiceRepository: vi.fn(function() { return mockRepo; }),
      })
    );

    vi.doMock("@/infrastructure/queue/queues.js", () => ({
      syncQueue: {
        enqueueReconcile: vi.fn(async () => {}),
        enqueuePaymentSync: vi.fn(async () => {}),
      },
    }));

    const { registerRoutes: registerRoutesActual } = await import(
      "@/infrastructure/http/routes"
    );

    app = buildApp();
    await registerRoutesActual(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("POST /invoices returns 201", async () => {
    mockRepo.save.mockClear();

    const response = await app.inject({
      method: "POST",
      url: "/invoices",
      headers: { authorization: "Bearer test-api-key" },
      payload: {
        customerId: "cust-1",
        lineItems: [
          {
            description: "Test item",
            quantity: 2,
            unitPrice: 10,
            amount: 20,
          },
        ],
        totalAmount: 20,
        currency: "USD",
        status: "draft",
        dueDate: "2030-01-01",
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json<{ customerId: string; totalAmount: string; lineItems: unknown[] }>();

    expect(body.customerId).toBe("cust-1");
    expect(body.totalAmount).toBe("20.00");
    expect(Array.isArray(body.lineItems)).toBe(true);
  });

  it("PATCH /invoices/:id returns 200 and updates", async () => {
    mockRepo.save.mockClear();

    const response = await app.inject({
      method: "PATCH",
      url: "/invoices/inv-1",
      headers: { authorization: "Bearer test-api-key" },
      payload: {
        totalAmount: 150,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ id: string; totalAmount: string }>();

    expect(body.id).toBe("inv-1");
    expect(body.totalAmount).toBe("150.00");
  });

  it("PATCH /invoices/:id returns 404 when invoice not found", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: "/invoices/missing",
      headers: { authorization: "Bearer test-api-key" },
      payload: {
        totalAmount: 150,
      },
    });

    expect(response.statusCode).toBe(404);
    const body = response.json<{ error: string }>();

    expect(body.error).toBe("NotFoundError");
  });
});

