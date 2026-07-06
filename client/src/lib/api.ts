import type {
  ApiLineItem,
  CreateInvoiceBody,
  InvoiceResponse as Invoice,
  MappingResponse,
  SyncLinkDetailResponse as SyncLinkDetail,
  SyncLinkResponse as SyncLink,
} from '../../../src/shared/api-contracts.ts'

const BASE = ''

export interface LineItem {
  description: string
  quantity: number
  unitPrice: number
  amount: number
}

export type { ApiLineItem, CreateInvoiceBody, Invoice, SyncLink, SyncLinkDetail }
export type AccountMap = MappingResponse['accounts'][number]
export type ItemMap = MappingResponse['items'][number]
export type CustomerMap = MappingResponse['customers'][number]

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
  if (!res.ok) {
    let message = `${method} ${path} → ${res.status}`
    try {
      const errorBody = await res.json() as { message?: string; error?: string }
      message = errorBody.message ?? errorBody.error ?? message
    } catch {
      // Keep the status-based fallback for non-JSON error responses.
    }
    throw new Error(message)
  }
  return res.json() as Promise<T>
}

export function getHealth(apiKey?: string) {
  return req<{ status: string; timestamp: string }>('GET', '/health', undefined, apiKey)
}

export function getAuthStatus(apiKey?: string) {
  return req<{ valid: boolean; expiresAt: string; refreshTokenExpiresAt: string; refreshTokenExpiringSoon: boolean }>('GET', '/auth/qbo/status', undefined, apiKey)
}

export function validateApiKey(apiKey?: string) {
  return req<{ valid: true }>('GET', '/auth/api-key/validate', undefined, apiKey)
}

export function getInvoices(apiKey?: string) {
  return req<Invoice[]>('GET', '/invoices', undefined, apiKey)
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
  return req<MappingResponse>('GET', '/sync/mappings', undefined, apiKey)
}

export function triggerInitialLoad(apiKey?: string) {
  return req<{ enqueued: number; skipped: number }>('POST', '/sync/initial-load/internal-to-qbo', undefined, apiKey)
}

export function importFromQbo(params?: { limit?: number; startPosition?: number }, apiKey?: string) {
  const qs = new URLSearchParams()
  if (params?.limit !== undefined) qs.set('limit', String(params.limit))
  if (params?.startPosition !== undefined) qs.set('startPosition', String(params.startPosition))
  const query = qs.toString()
  return req<{ scanned: number; imported: number; skippedExisting: number; startPosition: number; nextStartPosition: number | null }>(
    'POST', `/sync/initial-load/qbo-to-internal${query ? `?${query}` : ''}`, undefined, apiKey
  )
}
