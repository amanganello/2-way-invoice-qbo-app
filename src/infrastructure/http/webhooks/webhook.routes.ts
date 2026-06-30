import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/config/env.js";
import { prisma } from "@/infrastructure/database/prisma.js";
import { invoiceSyncQueue } from "@/infrastructure/queue/queues.js";
import { redisConnection } from "@/infrastructure/queue/redis.js";

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
  app.post(
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

        await invoiceSyncQueue.add(
          "pull",
          { qboId: entity.id, eventType: entity.operation, eventId },
          { jobId: `pull-${entity.id}` }
        );
      }

      return reply.status(200).send({ ok: true });
    }
  );
}
