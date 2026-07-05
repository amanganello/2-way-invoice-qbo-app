import { prisma } from "./prisma.js";
import type { SyncStatus } from "@prisma/client";
import type { PaymentSyncLinkPort, PaymentSyncLinkRecord } from "@/application/ports/sync.ports.js";

export const paymentSyncLinkRepository: PaymentSyncLinkPort = {
  async findByInternalId(internalId: string): Promise<PaymentSyncLinkRecord | null> {
    const row = await prisma.paymentSyncLink.findUnique({ where: { internalId } });
    return row as PaymentSyncLinkRecord | null;
  },

  async findByInvoiceInternalId(invoiceInternalId: string): Promise<PaymentSyncLinkRecord[]> {
    return prisma.paymentSyncLink.findMany({ where: { invoiceInternalId } }) as Promise<PaymentSyncLinkRecord[]>;
  },

  async create(data: {
    internalId: string;
    qboId: string;
    invoiceInternalId: string;
    syncStatus?: "SYNCED" | "PENDING" | "ERROR";
  }): Promise<PaymentSyncLinkRecord> {
    const row = await prisma.paymentSyncLink.create({
      data: {
        ...data,
        syncStatus: (data.syncStatus ?? "SYNCED") as SyncStatus,
        lastSyncedAt: new Date(),
      },
    });
    return row as PaymentSyncLinkRecord;
  },
};

export type PaymentSyncLinkRepository = typeof paymentSyncLinkRepository;
