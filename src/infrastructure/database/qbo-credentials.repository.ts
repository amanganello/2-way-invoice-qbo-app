import { prisma } from "./prisma.js";
import { encrypt, decrypt } from "@/shared/crypto/encryption.js";
import { env } from "@/config/env.js";

export type QBOCredentialsData = {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  refreshTokenExpiresAt: Date;
};

export const qboCredentialsRepository = {
  async get(): Promise<QBOCredentialsData | null> {
    const row = await prisma.qBOCredentials.findFirst();
    if (!row) return null;
    return {
      accessToken: decrypt(row.encryptedAccessToken, env.TOKEN_ENCRYPTION_KEY),
      refreshToken: decrypt(row.encryptedRefreshToken, env.TOKEN_ENCRYPTION_KEY),
      expiresAt: row.expiresAt,
      refreshTokenExpiresAt: row.refreshTokenExpiresAt,
    };
  },

  async save(data: QBOCredentialsData): Promise<void> {
    // NOTE: Do NOT use prisma.upsert here. upsert requires a unique where clause;
    // passing `id: ""` when no record exists passes Prisma validation but is fragile
    // and breaks if the schema enforces UUID format. Use explicit findFirst + branch.
    const existing = await prisma.qBOCredentials.findFirst();
    const encrypted = {
      encryptedAccessToken: encrypt(data.accessToken, env.TOKEN_ENCRYPTION_KEY),
      encryptedRefreshToken: encrypt(data.refreshToken, env.TOKEN_ENCRYPTION_KEY),
      expiresAt: data.expiresAt,
      refreshTokenExpiresAt: data.refreshTokenExpiresAt,
    };
    if (existing) {
      await prisma.qBOCredentials.update({ where: { id: existing.id }, data: encrypted });
    } else {
      await prisma.qBOCredentials.create({ data: encrypted });
    }
  },

  async updateTokens(data: QBOCredentialsData): Promise<void> {
    const existing = await prisma.qBOCredentials.findFirst();
    if (!existing) throw new Error("No QBO credentials found to update");
    await prisma.$transaction(async (tx) => {
      await tx.qBOCredentials.update({
        where: { id: existing.id },
        data: {
          encryptedAccessToken: encrypt(data.accessToken, env.TOKEN_ENCRYPTION_KEY),
          encryptedRefreshToken: encrypt(data.refreshToken, env.TOKEN_ENCRYPTION_KEY),
          expiresAt: data.expiresAt,
          refreshTokenExpiresAt: data.refreshTokenExpiresAt,
        },
      });
    });
  },
};
