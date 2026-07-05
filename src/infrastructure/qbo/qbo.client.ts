import { env } from "@/config/env.js";
import { qboCredentialsRepository } from "@/infrastructure/database/qbo-credentials.repository.js";
import logger from "@/infrastructure/logger/index.js";
import { ExternalServiceError, NotFoundError } from "@/shared/errors/app-error.js";
import {
  QboAlreadyVoidedError,
  QboDuplicateDocumentError,
  QboRateLimitedError,
  QboStaleObjectError,
} from "@/application/sync/qbo-sync-errors.js";
import type { QBOFault } from "./qbo.types.js";

const BASE_URLS = {
  sandbox: "https://sandbox-quickbooks.api.intuit.com/v3/company",
  production: "https://quickbooks.api.intuit.com/v3/company",
} as const;

const REFRESH_BEFORE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
const REFRESH_TOKEN_WARN_DAYS = 14;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_REQUEST_ATTEMPTS = 3;

export class QBOClient {
  private baseUrl: string;
  // In-process mutex: prevents concurrent jobs from each triggering a
  // separate OAuth refresh with the same refresh token. Intuit refresh
  // tokens are one-time-use — two simultaneous refresh calls with the
  // same token will cause one to fail or produce stale tokens.
  // Node.js is single-threaded so a shared promise is sufficient.
  private refreshPromise: Promise<string> | null = null;

  constructor() {
    this.baseUrl = `${BASE_URLS[env.QB_ENVIRONMENT]}/${env.QB_REALM_ID}`;
  }

  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    parse?: (json: unknown) => T
  ): Promise<T> {
    return this.requestWithRetry(method, path, body, parse, 1);
  }

  private async requestWithRetry<T>(
    method: string,
    path: string,
    body: unknown,
    parse: ((json: unknown) => T) | undefined,
    attempt: number
  ): Promise<T> {
    const accessToken = await this.getValidAccessToken();
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: body != null ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const text = await response.text();
      const json = this.parseResponseBody(text, response.status);

      if (response.status === 429) {
        const retryAfter = response.headers.get("Retry-After") ?? "60";
        logger.warn({ retryAfter, attempt }, "QBO rate limit hit (429)");
        if (attempt < MAX_REQUEST_ATTEMPTS) {
          await this.delay(Math.min(Number(retryAfter) * 1000 || 1000, 5000));
          return this.requestWithRetry(method, path, body, parse, attempt + 1);
        }
        throw new QboRateLimitedError(retryAfter);
      }

      if (this.isQboFault(json)) {
        const err = json.Fault.Error[0];
        throw this.toQboError(err);
      }

      if (!response.ok) {
        if (this.isTransientStatus(response.status) && attempt < MAX_REQUEST_ATTEMPTS) {
          await this.delay(1000 * attempt);
          return this.requestWithRetry(method, path, body, parse, attempt + 1);
        }
        throw new ExternalServiceError(`QBO API error: ${response.status}`);
      }

      return parse ? parse(json) : json as T;
    } catch (err) {
      if (err instanceof ExternalServiceError) throw err;
      if (err instanceof Error && err.name === "AbortError") {
        if (attempt < MAX_REQUEST_ATTEMPTS) {
          await this.delay(1000 * attempt);
          return this.requestWithRetry(method, path, body, parse, attempt + 1);
        }
        throw new ExternalServiceError("QBO API request timed out");
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  async query<T>(query: string): Promise<T[]> {
    const encoded = encodeURIComponent(query);
    type QueryShape = { QueryResponse: Record<string, T[]> };
    const result = await this.request<QueryShape>("GET", `/query?query=${encoded}&minorversion=65`);
    const values = Object.values(result.QueryResponse).find(v => Array.isArray(v));
    return (values as T[]) ?? [];
  }

  private async getValidAccessToken(): Promise<string> {
    const creds = await qboCredentialsRepository.get();
    if (!creds) throw new NotFoundError("No QBO credentials found — run scripts/qbo-auth.ts first");

    this.warnIfRefreshTokenExpiringSoon(creds.refreshTokenExpiresAt);

    const nowPlusBuffer = new Date(Date.now() + REFRESH_BEFORE_EXPIRY_MS);
    if (creds.expiresAt > nowPlusBuffer) {
      return creds.accessToken;
    }

    // Mutex: if a refresh is already in flight, wait for it instead of
    // starting a second one. Concurrent jobs hitting an expiring token
    // at the same time will all receive the same new token once the
    // single refresh resolves. The promise is cleared in `finally` so
    // the next expiry cycle triggers a fresh refresh.
    if (!this.refreshPromise) {
      this.refreshPromise = this.refreshWithRetry(creds.refreshToken)
        .finally(() => { this.refreshPromise = null; });
    }
    return this.refreshPromise;
  }

  private async refreshWithRetry(refreshToken: string, attempt = 1): Promise<string> {
    try {
      const { default: OAuthClient } = await import("intuit-oauth");
      const client = new OAuthClient({
        clientId: env.QB_CLIENT_ID,
        clientSecret: env.QB_CLIENT_SECRET,
        environment: env.QB_ENVIRONMENT,
        redirectUri: env.QB_REDIRECT_URI,
      });
      client.setToken({ refresh_token: refreshToken });
      const refreshResponse = await client.refresh();
      const tokens = refreshResponse.getJson() as {
        access_token: string;
        refresh_token: string;
        expires_in: number;
        x_refresh_token_expires_in: number;
      };

      const now = Date.now();
      const newCreds = {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: new Date(now + tokens.expires_in * 1000),
        refreshTokenExpiresAt: new Date(now + tokens.x_refresh_token_expires_in * 1000),
      };

      await qboCredentialsRepository.updateTokens(newCreds);
      return newCreds.accessToken;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Never retry auth rejections — Intuit refresh tokens are one-time-use.
      // Retrying with a consumed token just burns the next token too.
      // "invalid_grant" is OAuth2's canonical error for an expired/consumed refresh token.
      const isAuthError = msg.includes("invalid_grant") || msg.toLowerCase().includes("unauthorized") || msg.toLowerCase().includes("401");
      if (!isAuthError && attempt < 3) {
        await new Promise(r => setTimeout(r, 5000));
        return this.refreshWithRetry(refreshToken, attempt + 1);
      }
      logger.error({ err, attempt }, "QBO token refresh exhausted after 3 attempts");
      throw new ExternalServiceError("QBO token refresh failed after 3 attempts");
    }
  }

  private warnIfRefreshTokenExpiringSoon(refreshTokenExpiresAt: Date): void {
    const daysLeft = (refreshTokenExpiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    if (daysLeft < REFRESH_TOKEN_WARN_DAYS) {
      logger.warn({ daysLeft: Math.floor(daysLeft) }, "QBO refresh token expiring soon — re-run scripts/qbo-auth.ts");
    }
  }

  private parseResponseBody(text: string, status: number): unknown {
    if (!text) return {};
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new ExternalServiceError(`QBO API returned invalid JSON (${status})`);
    }
  }

  private isQboFault(json: unknown): json is QBOFault {
    return Boolean(
      json &&
      typeof json === "object" &&
      "Fault" in json &&
      Array.isArray((json as QBOFault).Fault?.Error)
    );
  }

  private isTransientStatus(status: number): boolean {
    return status === 408 || status === 425 || status === 500 || status === 502 || status === 503 || status === 504;
  }

  private toQboError(error: QBOFault["Fault"]["Error"][number]): ExternalServiceError {
    const message = error.Message;
    const detail = error.Detail ?? "";
    const code = error.code ?? "";
    const combined = `${message} ${detail} ${code}`.toLowerCase();

    if (code === "6240" || combined.includes("duplicate")) {
      return new QboDuplicateDocumentError(`QBO API fault: ${message}`);
    }
    if (combined.includes("stale object") || combined.includes("stale")) {
      return new QboStaleObjectError(`QBO API fault: ${message}`);
    }
    if (combined.includes("already voided") || combined.includes("voided")) {
      return new QboAlreadyVoidedError(`QBO API fault: ${message}`);
    }
    return new ExternalServiceError(`QBO API fault: ${message}`);
  }

  private async delay(ms: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const qboClient = new QBOClient();
