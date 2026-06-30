import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/config/env.js";
import { prisma } from "@/infrastructure/database/prisma.js";
import { invoiceSyncQueue } from "@/infrastructure/queue/queues.js";
import { redisConnection } from "@/infrastructure/queue/redis.js";
import logger from "@/infrastructure/logger/index.js";

type QBOEntity = { name: string; id: string; operation: string; lastUpdated: string };
type QBOWebhookPayload = {
  eventNotifications: Array<{
    realmId: string;
    dataChangeEvent: { entities: QBOEntity[] };
  }>;
};

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
    // Wildcard parser: handles QBO webhook probes that send no Content-Type header.
    // Scoped to this plugin only — does not affect any other route.
    scope.addContentTypeParser(
      "*",
      { parseAs: "string" },
      (req: FastifyRequest, body: unknown, done: (err: Error | null, result?: unknown) => void) => {
        (req as FastifyRequest & { rawBody?: string }).rawBody = body as string;
        try {
          done(null, JSON.parse(body as string));
        } catch (err) {
          done(err as Error, undefined);
        }
      }
    );

    scope.post(
      "/webhooks/qbo",
      { config: { rawBody: true } },
      async (request: FastifyRequest, reply: FastifyReply) => {
        const signature = request.headers["intuit-signature-hash"] as string | undefined;
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

        const payload = request.body as QBOWebhookPayload;
        const entities = payload.eventNotifications.flatMap(
          n => n.dataChangeEvent.entities
        );

        for (const entity of entities) {
          const eventId = `${entity.name}-${entity.id}-${entity.lastUpdated}`;

          // Deduplicate via unique EventLog insert — constraint is the guard, not a pre-check
          const result = await prisma.eventLog.createMany({
            data: [{
              eventId,
              source: "QBO",
              eventType: entity.operation,
              payload: entity as object,
            }],
            skipDuplicates: true,
          });

          if (result.count === 0) continue; // already processed

          // Guard: if Redis fails between the ping check and the enqueue, the EventLog row
          // is already committed and QBO will not retry — return 503 to signal failure.
          try {
            await invoiceSyncQueue.add(
              "pull",
              { qboId: entity.id, eventType: entity.operation, eventId },
              { jobId: `pull-${entity.id}` }
            );
          } catch (err) {
            logger.error({ err, qboId: entity.id, eventId }, "Failed to enqueue pull job");
            return reply.status(503).send({ error: "Queue unavailable" });
          }
        }

        return reply.status(200).send({ ok: true });
      }
    );
  });
}
