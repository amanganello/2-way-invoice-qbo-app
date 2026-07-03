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

export function getHealth() {
  return req<{ status: string; timestamp: string }>('GET', '/health')
}

export function getAuthStatus() {
  return req<{ valid: boolean; expiresAt: string; refreshTokenExpiresAt: string; refreshTokenExpiringSoon: boolean }>('GET', '/auth/qbo/status')
}

export function createInvoice(body: CreateInvoiceBody) {
  return req<Invoice>('POST', '/invoices', body)
}

export function updateInvoice(id: string, body: Partial<CreateInvoiceBody>) {
  return req<Invoice>('PATCH', `/invoices/${id}`, body)
}

export function getSyncLinks(params?: { syncStatus?: string; limit?: number }) {
  const qs = new URLSearchParams()
  if (params?.syncStatus !== undefined) qs.set('syncStatus', params.syncStatus)
  if (params?.limit !== undefined) qs.set('limit', String(params.limit))
  const query = qs.toString()
  return req<SyncLink[]>('GET', `/sync/links${query ? `?${query}` : ''}`)
}

export function getSyncLink(id: string) {
  return req<SyncLinkDetail>('GET', `/sync/links/${id}`)
}

export function getConflicts() {
  return req<SyncLink[]>('GET', '/sync/conflicts')
}

export function resolveConflict(id: string, strategy: 'accept-internal' | 'accept-qbo') {
  return req<{ ok: boolean; strategy: string; internalId: string }>('POST', `/sync/conflicts/${id}/resolve`, { strategy })
}

export function importMappings() {
  return req<{ accountsImported: number; itemsImported: number; customersImported: number }>('POST', '/sync/mappings/import')
}

export function getMappings() {
  return req<{ accounts: AccountMap[]; items: ItemMap[]; customers: CustomerMap[] }>('GET', '/sync/mappings')
}

export function triggerInitialLoad() {
  return req<{ enqueued: number; skipped: number }>('POST', '/sync/initial-load/internal-to-qbo')
}
