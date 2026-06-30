import type { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from "fastify";
import { timingSafeEqual } from "node:crypto";
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
  if (!auth?.startsWith("Bearer ")) {
    reply.status(401).send({ error: "Unauthorized" });
    return;
  }

  const providedKey = auth.slice(7);
  const expectedKey = env.API_KEY;
  let keysEqual = false;
  try {
    keysEqual =
      providedKey.length === expectedKey.length &&
      timingSafeEqual(Buffer.from(providedKey), Buffer.from(expectedKey));
  } catch {
    keysEqual = false;
  }
  if (!keysEqual) {
    reply.status(401).send({ error: "Unauthorized" });
    return;
  }

  done();
}
