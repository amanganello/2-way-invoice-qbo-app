import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { env } from "@/config/env.js";
import { prisma } from "@/infrastructure/database/prisma.js";
import { invoiceSyncQueue } from "@/infrastructure/queue/queues.js";
import { redisConnection } from "@/infrastructure/queue/redis.js";
import logger from "@/infrastructure/logger/index.js";

const QBOEntitySchema = z.object({
  name: z.string(),
  id: z.string(),
  operation: z.string(),
  lastUpdated: z.string(),
});

const QBOWebhookPayloadSchema = z.object({
  eventNotifications: z.array(
    z.object({
      realmId: z.string(),
      dataChangeEvent: z.object({
        entities: z.array(QBOEntitySchema),
      }),
    })
  ),
});

function verifySignature(body: string, signature: string): boolean {
  const expected = createHmac("sha256", env.QB_WEBHOOK_VERIFIER_TOKEN).update(body).digest("base64");
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

export async function registerWebhookRoutes(app: FastifyInstance): Promise<void> {
  // Encapsulate in a scoped plugin so the wildcard content-type parser only applies to
  // webhook routes and does not bleed into invoice or other API routes.
  app.register(async (scope) => {
    // Register parsers for both application/json and wildcard (for QBO probes with no
    // Content-Type). Both capture the raw string before parsing so HMAC verification
    // uses the original bytes, not re-serialized JSON. Scoped to this plugin only.
    const rawBodyParser = (
      req: FastifyRequest,
      body: unknown,
      done: (err: Error | null, result?: unknown) => void
    ) => {
      (req as FastifyRequest & { rawBody?: string }).rawBody = body as string;
      try {
        done(null, body === "" ? {} : JSON.parse(body as string));
      } catch (err) {
        done(err as Error, undefined);
      }
    };
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser("application/json", { parseAs: "string" }, rawBodyParser);
    scope.addContentTypeParser("*", { parseAs: "string" }, rawBodyParser);

    scope.post(
      "/webhooks/qbo",
      { config: { rawBody: true } },
      async (request: FastifyRequest, reply: FastifyReply) => {
        const signature = (request.headers["intuit-signature"] ?? request.headers["intuit-signature-hash"]) as string | undefined;
        const rawBody = (request as { rawBody?: string }).rawBody ?? JSON.stringify(request.body);

        if (!signature || !verifySignature(rawBody, signature)) {
          return reply.status(401).send({ error: "Invalid signature" });
        }

        // Check Redis availability before processing
        try {
          await redisConnection.ping();
        } catch {
          return reply.status(503).send({ error: "Queue unavailable" });
        }

        const parsed = QBOWebhookPayloadSchema.safeParse(request.body);
        if (!parsed.success) {
          logger.warn({ err: parsed.error.flatten() }, "Invalid QBO webhook payload shape");
          return reply.status(400).send({ error: "Invalid payload" });
        }
        const entities = parsed.data.eventNotifications.flatMap(
          n => n.dataChangeEvent.entities
        );

        for (const entity of entities) {
          const eventId = `${entity.name}-${entity.id}-${entity.lastUpdated}`;

          // Enqueue BEFORE writing EventLog — if enqueue fails, no dedup row committed, QBO can retry
          try {
            await invoiceSyncQueue.add(
              "pull",
              { qboId: entity.id, entityType: entity.name, eventType: entity.operation, eventId },
              { jobId: `pull-${entity.name}-${entity.id}` }
            );
          } catch (err) {
            logger.error({ err, qboId: entity.id, eventId }, "Failed to enqueue pull job");
            return reply.status(503).send({ error: "Queue unavailable" });
          }

          // Write EventLog after job is durably queued
          // skipDuplicates handles concurrent retries; count === 0 means duplicate event
          const result = await prisma.eventLog.createMany({
            data: [{
              eventId,
              source: "QBO",
              eventType: entity.operation,
              payload: entity as object,
            }],
            skipDuplicates: true,
          });

          if (result.count === 0) {
            // Duplicate event — enqueue above was redundant but BullMQ jobId dedup is safe
            logger.debug({ eventId }, "Duplicate webhook event — skipped EventLog");
          }
        }

        return reply.status(200).send({ ok: true });
      }
    );
  });
}
