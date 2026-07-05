import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { randomUUID } from "node:crypto";
import OAuthClient from "intuit-oauth";
import { env } from "@/config/env.js";
import { qboCredentialsRepository } from "@/infrastructure/database/qbo-credentials.repository.js";
import { redisConnection } from "@/infrastructure/queue/redis.js";
import logger from "@/infrastructure/logger/index.js";

const REFRESH_TOKEN_WARN_DAYS = 14;
const OAUTH_STATE_TTL_SECONDS = 10 * 60;

type StateEntry = { frontendUrl: string };

async function storeOAuthState(state: string, entry: StateEntry): Promise<void> {
  await redisConnection.set(`oauth:state:${state}`, JSON.stringify(entry), "EX", OAUTH_STATE_TTL_SECONDS);
}

async function consumeOAuthState(state: string): Promise<StateEntry | null> {
  const key = `oauth:state:${state}`;
  const raw = await redisConnection.get(key);
  if (!raw) return null;
  await redisConnection.del(key);
  return JSON.parse(raw) as StateEntry;
}

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
    await storeOAuthState(state, { frontendUrl });

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

    const entry = await consumeOAuthState(state ?? "");
    if (!entry) {
      return reply.status(400).send({ error: "Invalid or expired OAuth state" });
    }

    const { frontendUrl } = entry;

    if (!code || !realmId) {
      return reply.redirect(`${frontendUrl}?auth=error&message=${encodeURIComponent('Authorization denied or missing parameters')}`);
    }

    try {
      const client = makeOAuthClient();
      // Reconstruct full callback URL (intuit-oauth requires it for token exchange)
      const callbackUrl = `${env.QB_REDIRECT_URI}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}&realmId=${encodeURIComponent(realmId)}`;
      const now = Date.now();
      const authResponse = await client.createToken(callbackUrl);
      const tokens = authResponse.getJson() as {
        access_token: string;
        refresh_token: string;
        expires_in: number;
        x_refresh_token_expires_in: number;
      };
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
