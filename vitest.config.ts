import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/tests/**/*.test.ts"],
    env: {
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
      QB_CLIENT_ID: "test-client-id",
      QB_CLIENT_SECRET: "test-client-secret",
      QB_REDIRECT_URI: "http://localhost:3000/callback",
      QB_ENVIRONMENT: "sandbox",
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
