import type { FastifyReply, FastifyRequest } from "fastify";
import { getHealthStatus } from "@/app.js";

export async function healthHandler(
  _request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (!getHealthStatus()) {
    return reply.status(503).send({
      status: "unhealthy",
      timestamp: new Date().toISOString(),
    });
  }
  await reply.status(200).send({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
}
