import type { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { env } from "@/config/env.js";

const UNPROTECTED = ["/health", "/webhooks/qbo", "/auth/qbo/callback"];

function keyMatches(provided: string): boolean {
  const expected = env.API_KEY;
  try {
    return (
      provided.length === expected.length &&
      timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
    );
  } catch {
    return false;
  }
}

export function apiKeyMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
  done: HookHandlerDoneFunction
): void {
  if (UNPROTECTED.some(path => request.url.startsWith(path))) {
    return done();
  }

  // Accept key from Authorization header (primary) or ?apiKey= query param
  // (fallback for browser redirects like /auth/qbo/start where <a> can't set headers)
  const auth = request.headers["authorization"];
  if (auth?.startsWith("Bearer ")) {
    if (keyMatches(auth.slice(7))) return done();
    reply.status(401).send({ error: "Unauthorized" });
    return;
  }

  const queryKey = (request.query as Record<string, string>)["apiKey"] ?? "";
  if (queryKey && keyMatches(queryKey)) return done();

  reply.status(401).send({ error: "Unauthorized" });
}
