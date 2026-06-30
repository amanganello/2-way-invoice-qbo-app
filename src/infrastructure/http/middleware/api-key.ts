import type { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from "fastify";
import { env } from "@/config/env.js";

const UNPROTECTED = ["/health", "/webhooks/qbo"];

export function apiKeyMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
  done: HookHandlerDoneFunction
): void {
  if (UNPROTECTED.some(path => request.url.startsWith(path))) {
    return done();
  }

  const auth = request.headers["authorization"];
  if (!auth?.startsWith("Bearer ") || auth.slice(7) !== env.API_KEY) {
    reply.status(401).send({ error: "Unauthorized", statusCode: 401, message: "Invalid or missing API key" });
    return;
  }

  done();
}
