export type QBOLine = {
  Id?: string;
  LineNum?: number;
  Amount: number;
  DetailType: string;
  SalesItemLineDetail?: {
    ItemRef: { value: string; name?: string };
    AccountRef?: { value: string };
    TaxCodeRef?: { value: string };
    Qty?: number;
    UnitPrice?: number;
  };
  SubTotalLineDetail?: unknown;
  Description?: string;
};

export type QBOInvoiceEntity = {
  Id?: string;
  SyncToken?: string;
  DocNumber?: string;
  CustomerRef: { value: string; name?: string };
  Line?: QBOLine[];
  TotalAmt?: number;
  Balance?: number;
  DueDate?: string;
  CurrencyRef?: { value: string };
  PrivateNote?: string;
  MetaData?: { CreateTime: string; LastUpdatedTime: string };
};

export type QBOPaymentEntity = {
  Id?: string;
  SyncToken?: string;
  PaymentRefNum?: string;
  CustomerRef: { value: string };
  TotalAmt: number;
  TxnDate?: string;
  LinkedTxn?: Array<{ TxnId: string; TxnType: string }>;
  MetaData?: { CreateTime: string; LastUpdatedTime: string };
};

export type QBOAccount = {
  Id: string;
  Name: string;
  FullyQualifiedName: string;
  AccountType: string;
  AccountSubType: string;
};

export type QBOItem = {
  Id: string;
  Name: string;
  Type: string;
  IncomeAccountRef?: { value: string; name?: string };
  TaxCodeRef?: { value: string };
};

export type QBOCustomer = {
  Id: string;
  DisplayName: string;
  Active: boolean;
};

export type QBOFault = {
  Fault: {
    Error: Array<{ Message: string; Detail: string; code: string }>;
    type: string;
  };
};

export type QBOQueryResponse<T> = {
  QueryResponse: Record<string, T[] | number>;
  time: string;
};
