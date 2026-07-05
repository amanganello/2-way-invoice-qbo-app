import { prisma } from "./prisma.js";
import type { AccountMapEntry, AccountMapPort } from "@/application/ports/sync.ports.js";

export const accountMapRepository: AccountMapPort = {
  async findByInternalCode(code: string): Promise<AccountMapEntry | null> {
    return prisma.accountMap.findUnique({ where: { internalAccountCode: code } });
  },

  async upsertMany(items: AccountMapEntry[]): Promise<number> {
    let count = 0;
    for (const item of items) {
      await prisma.accountMap.upsert({
        where: { internalAccountCode: item.internalAccountCode },
        create: item,
        update: { qboAccountId: item.qboAccountId, qboAccountName: item.qboAccountName },
      });
      count++;
    }
    return count;
  },

  async findAll(): Promise<AccountMapEntry[]> {
    return prisma.accountMap.findMany();
  },
};
