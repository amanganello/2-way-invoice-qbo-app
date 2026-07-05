import type { QboAccount, QboCatalogPort, QboCustomer, QboItem } from "@/application/ports/sync.ports.js";
import { qboClient } from "./qbo.client.js";
import { z } from "zod";

type AccountQueryShape = { QueryResponse: { Account?: QboAccount[] } };
type ItemQueryShape = { QueryResponse: { Item?: QboItem[] } };
type CustomerQueryShape = { QueryResponse: { Customer?: QboCustomer[] } };

const AccountQuerySchema = z.object({
  QueryResponse: z.object({
    Account: z.array(z.object({
      Id: z.string(),
      Name: z.string(),
      FullyQualifiedName: z.string(),
    })).optional(),
  }),
});
const ItemQuerySchema = z.object({
  QueryResponse: z.object({
    Item: z.array(z.object({
      Id: z.string(),
      Name: z.string(),
      TaxCodeRef: z.object({ value: z.string() }).optional(),
    })).optional(),
  }),
});
const CustomerQuerySchema = z.object({
  QueryResponse: z.object({
    Customer: z.array(z.object({
      Id: z.string(),
      DisplayName: z.string(),
    })).optional(),
  }),
});

export class QBOCatalogAdapter implements QboCatalogPort {
  async fetchIncomeAccounts(): Promise<QboAccount[]> {
    const result = await qboClient.request<AccountQueryShape>(
      "GET",
      `/query?query=${encodeURIComponent("SELECT * FROM Account WHERE AccountType='Income'")}&minorversion=65`,
      undefined,
      json => AccountQuerySchema.parse(json) as AccountQueryShape
    );
    return result.QueryResponse.Account ?? [];
  }

  async fetchItems(): Promise<QboItem[]> {
    const result = await qboClient.request<ItemQueryShape>(
      "GET",
      `/query?query=${encodeURIComponent("SELECT * FROM Item")}&minorversion=65`,
      undefined,
      json => ItemQuerySchema.parse(json) as ItemQueryShape
    );
    return result.QueryResponse.Item ?? [];
  }

  async fetchActiveCustomers(): Promise<QboCustomer[]> {
    const result = await qboClient.request<CustomerQueryShape>(
      "GET",
      `/query?query=${encodeURIComponent("SELECT * FROM Customer WHERE Active=true")}&minorversion=65`,
      undefined,
      json => CustomerQuerySchema.parse(json) as CustomerQueryShape
    );
    return result.QueryResponse.Customer ?? [];
  }
}
