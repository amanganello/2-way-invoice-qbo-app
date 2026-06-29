import { prisma } from "./prisma.js";

export type AccountMapEntry = {
  internalAccountCode: string;
  qboAccountId: string;
  qboAccountName: string;
};

export const accountMapRepository = {
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
