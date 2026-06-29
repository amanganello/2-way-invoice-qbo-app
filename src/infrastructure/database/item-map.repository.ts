import { prisma } from "./prisma.js";

export type ItemMapEntry = {
  internalItemCode: string;
  qboItemId: string;
  qboItemName: string;
  defaultTaxCode: string;
};

export const itemMapRepository = {
  async findByInternalCode(code: string): Promise<ItemMapEntry | null> {
    return prisma.itemMap.findUnique({ where: { internalItemCode: code } });
  },

  async upsertMany(items: ItemMapEntry[]): Promise<number> {
    let count = 0;
    for (const item of items) {
      await prisma.itemMap.upsert({
        where: { internalItemCode: item.internalItemCode },
        create: item,
        update: { qboItemId: item.qboItemId, qboItemName: item.qboItemName, defaultTaxCode: item.defaultTaxCode },
      });
      count++;
    }
    return count;
  },

  async findAll(): Promise<ItemMapEntry[]> {
    return prisma.itemMap.findMany();
  },
};
