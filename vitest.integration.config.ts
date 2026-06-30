import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/tests/integration/**/*.test.ts"],
    testTimeout: 30000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://invoice_user:invoice_pass@localhost:5432/invoice_sync_test",
      QB_CLIENT_ID: "test-client-id",
      QB_CLIENT_SECRET: "test-client-secret",
      QB_REDIRECT_URI: "http://localhost:3000/callback",
      QB_ENVIRONMENT: "sandbox",
      QB_REALM_ID: "test-realm",
      QB_WEBHOOK_VERIFIER_TOKEN: "test-token",
      TOKEN_ENCRYPTION_KEY: "a".repeat(64),
      API_KEY: "test-api-key",
      REDIS_URL: "redis://localhost:6379",
      RECONCILIATION_INTERVAL_MINUTES: "15",
      SYNC_JOB_MAX_RETRIES: "3",
      QBO_RATE_LIMIT_MAX: "2",
    },
  },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
});
