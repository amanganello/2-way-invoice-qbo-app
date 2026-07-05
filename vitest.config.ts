import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

const alias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/tests/e2e/**/*.test.ts", "src/tests/unit/**/*.test.ts"],
    exclude: ["src/tests/integration/**", "src/tests/sandbox/**"],
    env: {
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
      QB_CLIENT_ID: "test-client-id",
      QB_CLIENT_SECRET: "test-client-secret",
      QB_REDIRECT_URI: "http://localhost:3000/callback",
      QB_ENVIRONMENT: "sandbox",
      QB_REALM_ID: "test-realm-id",
      QB_WEBHOOK_VERIFIER_TOKEN: "test-webhook-token",
      TOKEN_ENCRYPTION_KEY: "a".repeat(64),
      API_KEY: "test-api-key",
      FRONTEND_URL: "http://localhost:5173",
      REDIS_URL: "redis://localhost:6379",
      RECONCILIATION_INTERVAL_MINUTES: "15",
      SYNC_JOB_MAX_RETRIES: "3",
      QBO_RATE_LIMIT_MAX: "2",
    },
  },
  resolve: { alias },
});
