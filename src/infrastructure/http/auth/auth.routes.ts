import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { qboCredentialsRepository } from "@/infrastructure/database/qbo-credentials.repository.js";
import logger from "@/infrastructure/logger/index.js";

const REFRESH_TOKEN_WARN_DAYS = 14;

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/auth/qbo/status", async (_request: FastifyRequest, reply: FastifyReply) => {
    const creds = await qboCredentialsRepository.get();

    if (!creds) {
      return reply.status(200).send({
        valid: false,
        expiresAt: null,
        refreshTokenExpiresAt: null,
        refreshTokenExpiringSoon: false,
      });
    }

    const now = Date.now();
    const valid = creds.expiresAt.getTime() > now;
    const daysLeft = (creds.refreshTokenExpiresAt.getTime() - now) / (1000 * 60 * 60 * 24);
    const refreshTokenExpiringSoon = daysLeft < REFRESH_TOKEN_WARN_DAYS;

    if (refreshTokenExpiringSoon) {
      logger.warn({ daysLeft: Math.floor(daysLeft) }, "QBO refresh token expiring soon");
    }

    return reply.status(200).send({
      valid,
      expiresAt: creds.expiresAt.toISOString(),
      refreshTokenExpiresAt: creds.refreshTokenExpiresAt.toISOString(),
      refreshTokenExpiringSoon,
    });
  });
}
