import type { FastifyReply, FastifyRequest } from "fastify";

export async function healthHandler(
  _request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  await reply.status(200).send({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
}
