import fastify, { type FastifyBaseLogger, type FastifyRequest } from "fastify";
import sensible from "@fastify/sensible";
import { ZodError } from "zod";
import logger from "@/infrastructure/logger/index.js";
import { AppError } from "@/shared/errors/app-error.js";

let isHealthy = true;
export function getHealthStatus() { return isHealthy; }

export function buildApp() {
  // Cast needed: pino.Logger's child() return type is narrower than FastifyBaseLogger expects
  const app = fastify({ logger: logger as unknown as FastifyBaseLogger });

  app.register(sensible);

  // Store raw string body for HMAC verification in webhook handler.
  // The wildcard parser handles requests with no content-type header (e.g. webhook signature tests).
  const storeRawAndParseJson = (
    _req: Parameters<Parameters<typeof app.addContentTypeParser>[2]>[0],
    body: unknown,
    done: (err: Error | null, result?: unknown) => void,
  ) => {
    (_req as FastifyRequest & { rawBody?: string }).rawBody = body as string;
    try {
      done(null, JSON.parse(body as string));
    } catch (err) {
      done(err as Error, undefined);
    }
  };

  app.addContentTypeParser("application/json", { parseAs: "string" }, storeRawAndParseJson);
  // Note: the wildcard "*" parser is intentionally NOT registered globally here.
  // It is scoped to the /webhooks/qbo route only, via a Fastify encapsulated plugin
  // in src/infrastructure/http/webhooks/webhook.routes.ts, so it cannot affect other routes.

  app.setErrorHandler((error, _request, reply) => {
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

    app.log.fatal({ err: error }, "Non-operational error — marking process unhealthy");
    isHealthy = false;
    return reply.status(500).send({
      error: "InternalServerError",
      statusCode: 500,
      message: "An unexpected error occurred",
    });
  });

  return app;
}
