import { prisma } from "./prisma.js";
import type { ItemMapEntry, ItemMapPort } from "@/application/ports/sync.ports.js";

export const itemMapRepository: ItemMapPort = {
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
