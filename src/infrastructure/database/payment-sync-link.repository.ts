import { prisma } from "./prisma.js";
import type { SyncStatus } from "@prisma/client";

export type PaymentSyncLinkRecord = {
  id: string;
  internalId: string;
  qboId: string;
  invoiceInternalId: string;
  syncStatus: "SYNCED" | "PENDING" | "ERROR";
  lastSyncedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export const paymentSyncLinkRepository = {
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
