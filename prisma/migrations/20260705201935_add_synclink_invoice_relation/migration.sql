-- DropForeignKey
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_syncLinkId_fkey";

-- AlterTable
ALTER TABLE "AuditLog" ALTER COLUMN "syncLinkId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "SyncLink" ADD CONSTRAINT "SyncLink_internalId_fkey" FOREIGN KEY ("internalId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_syncLinkId_fkey" FOREIGN KEY ("syncLinkId") REFERENCES "SyncLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;
