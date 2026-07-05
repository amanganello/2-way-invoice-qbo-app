import { prisma } from "./prisma.js";
import type { CustomerMapEntry, CustomerMapPort } from "@/application/ports/sync.ports.js";

export const customerMapRepository: CustomerMapPort = {
  async findByInternalId(id: string): Promise<CustomerMapEntry | null> {
    return prisma.customerMap.findUnique({ where: { internalCustomerId: id } });
  },

  async upsertMany(items: CustomerMapEntry[]): Promise<number> {
    let count = 0;
    for (const item of items) {
      await prisma.customerMap.upsert({
        where: { internalCustomerId: item.internalCustomerId },
        create: item,
        update: { qboCustomerId: item.qboCustomerId, qboCustomerName: item.qboCustomerName },
      });
      count++;
    }
    return count;
  },

  async findAll(): Promise<CustomerMapEntry[]> {
    return prisma.customerMap.findMany();
  },
};
