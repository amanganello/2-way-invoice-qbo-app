import type { Payment } from "@/domain/invoices/invoice.types.js";
import type { QBOPaymentPort, QBOPaymentResult } from "@/application/ports/qbo.ports.js";
import { qboClient } from "./qbo.client.js";
import type { QBOPaymentEntity } from "./qbo.types.js";
import { z } from "zod";

type PaymentResponse = { Payment: QBOPaymentEntity };
type QueryResponse = { QueryResponse: { Payment?: QBOPaymentEntity[] } };

const QBOPaymentEntitySchema = z.object({
  Id: z.string().optional(),
  SyncToken: z.string().optional(),
  PaymentRefNum: z.string().optional(),
  CustomerRef: z.object({ value: z.string() }),
  TotalAmt: z.number(),
  TxnDate: z.string().optional(),
  LinkedTxn: z.array(z.object({ TxnId: z.string(), TxnType: z.string() })).optional(),
  MetaData: z.object({ CreateTime: z.string(), LastUpdatedTime: z.string() }).optional(),
}) satisfies z.ZodType<QBOPaymentEntity>;
const PaymentResponseSchema = z.object({ Payment: QBOPaymentEntitySchema });
const QueryResponseSchema = z.object({
  QueryResponse: z.object({ Payment: z.array(QBOPaymentEntitySchema).optional() }),
});

export class QBOPaymentAdapter implements QBOPaymentPort {
  async createPayment(
    payment: Payment,
    customerRef: string,
    qboInvoiceId: string
  ): Promise<QBOPaymentResult> {
    const payload: QBOPaymentEntity = {
      CustomerRef: { value: customerRef },
      TotalAmt: parseFloat(payment.amount),
      PaymentRefNum: payment.id,
      TxnDate: payment.paidAt.toISOString().split("T")[0],
      LinkedTxn: [{ TxnId: qboInvoiceId, TxnType: "Invoice" }],
    };
    const res = await qboClient.request<PaymentResponse>(
      "POST",
      "/payment?minorversion=65",
      payload,
      json => PaymentResponseSchema.parse(json)
    );
    return {
      qboId: res.Payment.Id!,
      qboSyncToken: res.Payment.SyncToken!,
    };
  }

  async findByPaymentRefNum(refNum: string): Promise<QBOPaymentResult[]> {
    const res = await qboClient.request<QueryResponse>(
      "GET",
      `/query?query=${encodeURIComponent(`SELECT * FROM Payment WHERE PaymentRefNum = '${refNum}'`)}&minorversion=65`,
      undefined,
      json => QueryResponseSchema.parse(json)
    );
    return (res.QueryResponse.Payment ?? []).map(p => ({
      qboId: p.Id!,
      qboSyncToken: p.SyncToken!,
    }));
  }
}
