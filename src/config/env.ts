import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  PORT: z.coerce.number().int().positive().default(3000),

  QB_CLIENT_ID: z.string().min(1, "QB_CLIENT_ID is required"),
  QB_CLIENT_SECRET: z.string().min(1, "QB_CLIENT_SECRET is required"),
  QB_REDIRECT_URI: z.string().url("QB_REDIRECT_URI must be a valid URL"),
  QB_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),
  QB_REALM_ID: z.string().min(1, "QB_REALM_ID is required"),
  QB_WEBHOOK_VERIFIER_TOKEN: z.string().min(1, "QB_WEBHOOK_VERIFIER_TOKEN is required"),
  QB_DEFAULT_CUSTOMER_ID: z.string().optional(),
  QB_DEFAULT_ITEM_ID: z.string().optional(),

  TOKEN_ENCRYPTION_KEY: z.string().length(64, "TOKEN_ENCRYPTION_KEY must be 32-byte hex (64 chars)").regex(/^[0-9a-f]{64}$/i, "TOKEN_ENCRYPTION_KEY must be 32-byte hex (64 hex chars)"),
  API_KEY: z.string().min(1, "API_KEY is required"),
  FRONTEND_URL: z.string().default("/"),

  REDIS_URL: z.string().default("redis://localhost:6379"),
  REDIS_PASSWORD: z.string().optional(),

  RECONCILIATION_INTERVAL_MINUTES: z.coerce.number().int().positive().default(15),
  SYNC_JOB_MAX_RETRIES: z.coerce.number().int().positive().default(3),
  QBO_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(2),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  console.error("Invalid environment variables:");
  for (const issue of result.error.issues) {
    console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = result.data;
export type Env = typeof env;
