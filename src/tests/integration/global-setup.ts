import { execSync } from "node:child_process";

const DB_URL = "postgresql://invoice_user:invoice_pass@localhost:5432/invoice_sync_test";

export async function setup() {
  execSync(
    `docker compose exec -T postgres psql -U invoice_user -d postgres -c "CREATE DATABASE invoice_sync_test;" 2>/dev/null || true`,
    { stdio: "inherit" }
  );

  execSync("pnpm prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: DB_URL },
    stdio: "inherit",
  });
}
