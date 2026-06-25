import fastify, { type FastifyBaseLogger } from "fastify";
import sensible from "@fastify/sensible";
import { ZodError } from "zod";
import logger from "@/infrastructure/logger/index.js";
import { AppError } from "@/shared/errors/app-error.js";

export function buildApp() {
  // Cast needed: pino.Logger's child() return type is narrower than FastifyBaseLogger expects
  const app = fastify({ logger: logger as unknown as FastifyBaseLogger });

  app.register(sensible);

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

    app.log.error({ err: error }, "Unhandled error");
    return reply.status(500).send({
      error: "InternalServerError",
      statusCode: 500,
      message: "An unexpected error occurred",
    });
  });

  return app;
}
