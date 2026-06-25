import { PrismaClient } from "@prisma/client";
import { env } from "@/config/env.js";

const createPrismaClient = () =>
  new PrismaClient({
    datasources: {
      db: { url: env.DATABASE_URL },
    },
  });

// Prevent multiple instances in development due to hot reload
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ?? createPrismaClient();

if (env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
