import type { PaymentInput, QBOPaymentPort, QBOPaymentResult } from "@/domain/invoices/invoice.types.js";
import { qboClient } from "./qbo.client.js";
import type { QBOPaymentEntity } from "./qbo.types.js";

type PaymentResponse = { Payment: QBOPaymentEntity };
type QueryResponse = { QueryResponse: { Payment?: QBOPaymentEntity[] } };

export class QBOPaymentAdapter implements QBOPaymentPort {
  async createPayment(
    payment: PaymentInput,
    customerRef: string,
    qboInvoiceId: string
  ): Promise<QBOPaymentResult> {
    const payload: QBOPaymentEntity = {
      CustomerRef: { value: customerRef },
      TotalAmt: payment.amount,
      PaymentRefNum: payment.id,
      TxnDate: payment.paidAt.toISOString().split("T")[0],
      LinkedTxn: [{ TxnId: qboInvoiceId, TxnType: "Invoice" }],
    };
    const res = await qboClient.request<PaymentResponse>("POST", "/payment?minorversion=65", payload);
    return {
      qboId: res.Payment.Id!,
      qboSyncToken: res.Payment.SyncToken!,
    };
  }

  async findByPaymentRefNum(refNum: string): Promise<QBOPaymentResult[]> {
    const res = await qboClient.request<QueryResponse>(
      "GET",
      `/query?query=${encodeURIComponent(`SELECT * FROM Payment WHERE PaymentRefNum = '${refNum}'`)}&minorversion=65`
    );
    return (res.QueryResponse.Payment ?? []).map(p => ({
      qboId: p.Id!,
      qboSyncToken: p.SyncToken!,
    }));
  }
}
