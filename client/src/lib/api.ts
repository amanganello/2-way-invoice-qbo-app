const BASE = ''

export interface LineItem {
  description: string
  quantity: number
  unitPrice: number
  amount: number
}

export interface CreateInvoiceBody {
  customerId: string
  lineItems: LineItem[]
  totalAmount: number
  currency: string
  status: string
  dueDate: string
}

export interface Invoice {
  id: string
  customerId: string
  lineItems: LineItem[]
  totalAmount: number
  currency: string
  status: string
  dueDate: string
  createdAt: string
  updatedAt: string
}

export interface SyncLink {
  id: string
  internalId: string
  qboId: string | null
  syncStatus: string
  qboSyncToken: string | null
  lastSyncedAt: string | null
}

export interface AuditLog {
  id: string
  action: string
  result: string
  errorMessage: string | null
  createdAt: string
  beforeState: unknown
  afterState: unknown
}

export interface SyncLinkDetail extends SyncLink {
  auditLogs: AuditLog[]
}

export interface AccountMap {
  internalCode: string
  qboAccountId: string
  name: string
}

export interface ItemMap {
  internalItemCode: string
  qboItemId: string
  name: string
  taxCode: string | null
}

export interface CustomerMap {
  internalCustomerId: string
  qboCustomerId: string
  name: string
}

function getHeaders(apiKey?: string): HeadersInit {
  const key = apiKey ?? localStorage.getItem('apiKey') ?? ''
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }
}

async function req<T>(method: string, path: string, body?: unknown, apiKey?: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: getHeaders(apiKey),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}`)
  return res.json() as Promise<T>
}

export function getHealth(apiKey?: string) {
  return req<{ status: string; timestamp: string }>('GET', '/health', undefined, apiKey)
}

export function getAuthStatus(apiKey?: string) {
  return req<{ valid: boolean; expiresAt: string; refreshTokenExpiresAt: string; refreshTokenExpiringSoon: boolean }>('GET', '/auth/qbo/status', undefined, apiKey)
}

export function createInvoice(body: CreateInvoiceBody, apiKey?: string) {
  return req<Invoice>('POST', '/invoices', body, apiKey)
}

export function updateInvoice(id: string, body: Partial<CreateInvoiceBody>, apiKey?: string) {
  return req<Invoice>('PATCH', `/invoices/${id}`, body, apiKey)
}

export function getSyncLinks(params?: { syncStatus?: string; limit?: number }, apiKey?: string) {
  const qs = new URLSearchParams()
  if (params?.syncStatus !== undefined) qs.set('syncStatus', params.syncStatus)
  if (params?.limit !== undefined) qs.set('limit', String(params.limit))
  const query = qs.toString()
  return req<SyncLink[]>('GET', `/sync/links${query ? `?${query}` : ''}`, undefined, apiKey)
}

export function getSyncLink(id: string, apiKey?: string) {
  return req<SyncLinkDetail>('GET', `/sync/links/${id}`, undefined, apiKey)
}

export function getConflicts(apiKey?: string) {
  return req<SyncLink[]>('GET', '/sync/conflicts', undefined, apiKey)
}

export function resolveConflict(id: string, strategy: 'accept-internal' | 'accept-qbo', apiKey?: string) {
  return req<{ ok: boolean; strategy: string; internalId: string }>('POST', `/sync/conflicts/${id}/resolve`, { strategy }, apiKey)
}

export function importMappings(apiKey?: string) {
  return req<{ accountsImported: number; itemsImported: number; customersImported: number }>('POST', '/sync/mappings/import', undefined, apiKey)
}

export function getMappings(apiKey?: string) {
  return req<{ accounts: AccountMap[]; items: ItemMap[]; customers: CustomerMap[] }>('GET', '/sync/mappings', undefined, apiKey)
}

export function triggerInitialLoad(apiKey?: string) {
  return req<{ enqueued: number; skipped: number }>('POST', '/sync/initial-load/internal-to-qbo', undefined, apiKey)
}
