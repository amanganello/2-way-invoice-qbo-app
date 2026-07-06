-- AddForeignKey
ALTER TABLE "PaymentSyncLink" ADD CONSTRAINT "PaymentSyncLink_invoiceInternalId_fkey" FOREIGN KEY ("invoiceInternalId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
