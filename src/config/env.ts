import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  QB_CLIENT_ID: z.string().min(1, "QB_CLIENT_ID is required"),
  QB_CLIENT_SECRET: z.string().min(1, "QB_CLIENT_SECRET is required"),
  QB_REDIRECT_URI: z.string().url("QB_REDIRECT_URI must be a valid URL"),
  QB_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),
  PORT: z.coerce.number().int().positive().default(3000),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  console.error("❌ Invalid environment variables:");
  for (const issue of result.error.issues) {
    console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = result.data;
export type Env = typeof env;
