-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'SENT', 'PAID', 'VOID', 'OVERDUE');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('SYNCED', 'PENDING', 'PROCESSING', 'CONFLICT', 'ERROR');

-- CreateEnum
CREATE TYPE "EventSource" AS ENUM ('INTERNAL', 'QBO');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('PENDING', 'PROCESSED', 'SKIPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "AuditResult" AS ENUM ('SUCCESS', 'FAILURE');

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "lineItems" JSONB NOT NULL,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "dueDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "paidAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncLink" (
    "id" TEXT NOT NULL,
    "internalId" TEXT NOT NULL,
    "qboId" TEXT,
    "internalUpdatedAt" TIMESTAMP(3) NOT NULL,
    "qboUpdatedAt" TIMESTAMP(3),
    "qboSyncToken" TEXT,
    "lastSyncedSnapshot" JSONB,
    "syncStatus" "SyncStatus" NOT NULL DEFAULT 'PENDING',
    "lastSyncedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentSyncLink" (
    "id" TEXT NOT NULL,
    "internalId" TEXT NOT NULL,
    "qboId" TEXT NOT NULL,
    "invoiceInternalId" TEXT NOT NULL,
    "syncStatus" "SyncStatus" NOT NULL DEFAULT 'PENDING',
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentSyncLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountMap" (
    "id" TEXT NOT NULL,
    "internalAccountCode" TEXT NOT NULL,
    "qboAccountId" TEXT NOT NULL,
    "qboAccountName" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemMap" (
    "id" TEXT NOT NULL,
    "internalItemCode" TEXT NOT NULL,
    "qboItemId" TEXT NOT NULL,
    "qboItemName" TEXT NOT NULL,
    "defaultTaxCode" TEXT NOT NULL DEFAULT 'NON',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerMap" (
    "id" TEXT NOT NULL,
    "internalCustomerId" TEXT NOT NULL,
    "qboCustomerId" TEXT NOT NULL,
    "qboCustomerName" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QBOCredentials" (
    "id" TEXT NOT NULL,
    "encryptedAccessToken" TEXT NOT NULL,
    "encryptedRefreshToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "refreshTokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QBOCredentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventLog" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "source" "EventSource" NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "status" "EventStatus" NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "EventLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "syncLinkId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "sourceEventId" TEXT NOT NULL,
    "beforeState" JSONB,
    "afterState" JSONB,
    "result" "AuditResult" NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Invoice_customerId_idx" ON "Invoice"("customerId");

-- CreateIndex
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");

-- CreateIndex
CREATE INDEX "Payment_invoiceId_idx" ON "Payment"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "SyncLink_internalId_key" ON "SyncLink"("internalId");

-- CreateIndex
CREATE INDEX "SyncLink_syncStatus_idx" ON "SyncLink"("syncStatus");

-- CreateIndex
CREATE INDEX "SyncLink_qboId_idx" ON "SyncLink"("qboId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentSyncLink_internalId_key" ON "PaymentSyncLink"("internalId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentSyncLink_qboId_key" ON "PaymentSyncLink"("qboId");

-- CreateIndex
CREATE INDEX "PaymentSyncLink_syncStatus_idx" ON "PaymentSyncLink"("syncStatus");

-- CreateIndex
CREATE INDEX "PaymentSyncLink_invoiceInternalId_idx" ON "PaymentSyncLink"("invoiceInternalId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountMap_internalAccountCode_key" ON "AccountMap"("internalAccountCode");

-- CreateIndex
CREATE UNIQUE INDEX "ItemMap_internalItemCode_key" ON "ItemMap"("internalItemCode");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerMap_internalCustomerId_key" ON "CustomerMap"("internalCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "EventLog_eventId_key" ON "EventLog"("eventId");

-- CreateIndex
CREATE INDEX "EventLog_status_idx" ON "EventLog"("status");

-- CreateIndex
CREATE INDEX "EventLog_source_eventType_idx" ON "EventLog"("source", "eventType");

-- CreateIndex
CREATE INDEX "AuditLog_syncLinkId_idx" ON "AuditLog"("syncLinkId");

-- CreateIndex
CREATE INDEX "AuditLog_sourceEventId_idx" ON "AuditLog"("sourceEventId");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_syncLinkId_fkey" FOREIGN KEY ("syncLinkId") REFERENCES "SyncLink"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
