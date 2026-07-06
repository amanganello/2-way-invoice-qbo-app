import fastify, { type FastifyBaseLogger, type FastifyRequest } from "fastify";
import sensible from "@fastify/sensible";
import { ZodError } from "zod";
import logger from "@/infrastructure/logger/index.js";
import { AppError } from "@/shared/errors/app-error.js";
import { env } from "@/config/env.js";

let isHealthy = true;
export function getHealthStatus() { return isHealthy; }

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 120;
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

export function buildApp() {
  // Cast needed: pino.Logger's child() return type is narrower than FastifyBaseLogger expects
  const app = fastify({
    logger: logger as unknown as FastifyBaseLogger,
    bodyLimit: 1_048_576,
  });

  app.register(sensible);

  app.addHook("onRequest", (request, reply, done) => {
    const allowedOrigin = env.FRONTEND_URL === "/" ? undefined : env.FRONTEND_URL;
    const origin = request.headers.origin;
    if (allowedOrigin && origin === allowedOrigin) {
      reply.header("Access-Control-Allow-Origin", allowedOrigin);
      reply.header("Vary", "Origin");
    }
    reply.header("Access-Control-Allow-Headers", "Authorization, Content-Type");
    reply.header("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
    reply.header("X-Content-Type-Options", "nosniff");

    if (request.method === "OPTIONS") {
      reply.status(204).send();
      return;
    }

    done();
  });

  app.addHook("onRequest", (request, reply, done) => {
    if (request.url.startsWith("/health") || request.url.startsWith("/webhooks/qbo")) {
      done();
      return;
    }

    const key = request.ip;
    const now = Date.now();
    const bucket = rateLimitBuckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      rateLimitBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
      done();
      return;
    }
    bucket.count++;
    if (bucket.count > RATE_LIMIT_MAX_REQUESTS) {
      reply.status(429).send({ error: "RateLimitExceeded", statusCode: 429, message: "Too many requests" });
      return;
    }
    done();
  });

  // Store raw string body for HMAC verification in webhook handler.
  // The wildcard parser handles requests with no content-type header (e.g. webhook signature tests).
  const storeRawAndParseJson = (
    _req: Parameters<Parameters<typeof app.addContentTypeParser>[2]>[0],
    body: unknown,
    done: (err: Error | null, result?: unknown) => void,
  ) => {
    const raw = body as string;
    (_req as FastifyRequest & { rawBody?: string }).rawBody = raw;
    if (!raw) {
      done(null, undefined);
      return;
    }
    try {
      done(null, JSON.parse(raw));
    } catch (err) {
      done(err as Error, undefined);
    }
  };

  app.addContentTypeParser("application/json", { parseAs: "string" }, storeRawAndParseJson);
  // Note: the wildcard "*" parser is intentionally NOT registered globally here.
  // It is scoped to the /webhooks/qbo route only, via a Fastify encapsulated plugin
  // in src/infrastructure/http/webhooks/webhook.routes.ts, so it cannot affect other routes.

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: error.name,
        statusCode: error.statusCode,
        message: error.message,
      });
    }

    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: "ValidationError",
        statusCode: 400,
        message: "Validation failed",
        fields: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    app.log.fatal(
      { err: error, method: request.method, url: request.url },
      "Non-operational error — marking process unhealthy"
    );
    isHealthy = false;
    return reply.status(500).send({
      error: "InternalServerError",
      statusCode: 500,
      message: "An unexpected error occurred",
    });
  });

  return app;
}
