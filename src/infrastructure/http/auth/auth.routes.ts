import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { randomUUID } from "node:crypto";
import OAuthClient from "intuit-oauth";
import { env } from "@/config/env.js";
import { qboCredentialsRepository } from "@/infrastructure/database/qbo-credentials.repository.js";
import logger from "@/infrastructure/logger/index.js";

const REFRESH_TOKEN_WARN_DAYS = 14;

type StateEntry = { expiresAt: number; frontendUrl: string };
const pendingStates = new Map<string, StateEntry>();

function makeOAuthClient() {
  return new OAuthClient({
    clientId: env.QB_CLIENT_ID,
    clientSecret: env.QB_CLIENT_SECRET,
    environment: env.QB_ENVIRONMENT,
    redirectUri: env.QB_REDIRECT_URI,
  });
}

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

  // Protected by apiKeyMiddleware (accepts ?apiKey= query param — see middleware/api-key.ts)
  app.get("/auth/qbo/start", async (_request: FastifyRequest, reply: FastifyReply) => {
    const state = randomUUID();
    const frontendUrl = env.FRONTEND_URL;
    pendingStates.set(state, { expiresAt: Date.now() + 10 * 60 * 1000, frontendUrl });

    const client = makeOAuthClient();
    const authUri = client.authorizeUri({
      scope: [OAuthClient.scopes.Accounting],
      state,
    });

    return reply.redirect(authUri);
  });

  // Exempt from apiKeyMiddleware — registered before the hook in routes.ts
  app.get("/auth/qbo/callback", async (request: FastifyRequest, reply: FastifyReply) => {
    const { code, state, realmId } = request.query as Record<string, string>;

    const entry = pendingStates.get(state ?? "");
    if (!entry || Date.now() > entry.expiresAt) {
      pendingStates.delete(state ?? "");
      return reply.status(400).send({ error: "Invalid or expired OAuth state" });
    }
    pendingStates.delete(state);

    const { frontendUrl } = entry;

    try {
      const client = makeOAuthClient();
      // Reconstruct full callback URL (intuit-oauth requires it for token exchange)
      const callbackUrl = `${env.QB_REDIRECT_URI}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}&realmId=${encodeURIComponent(realmId)}`;
      const authResponse = await client.createToken(callbackUrl);
      const tokens = authResponse.getJson() as {
        access_token: string;
        refresh_token: string;
        expires_in: number;
        x_refresh_token_expires_in: number;
      };

      const now = Date.now();
      await qboCredentialsRepository.save({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: new Date(now + tokens.expires_in * 1000),
        refreshTokenExpiresAt: new Date(now + tokens.x_refresh_token_expires_in * 1000),
      });

      logger.info("QBO OAuth tokens saved via browser flow");
      return reply.redirect(`${frontendUrl}?auth=success`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown error";
      logger.error({ err }, "QBO OAuth callback failed");
      return reply.redirect(`${frontendUrl}?auth=error&message=${encodeURIComponent(msg)}`);
    }
  });
}
