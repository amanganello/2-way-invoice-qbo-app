import { useState, useEffect } from 'react'
import { getInvoices, createInvoice, updateInvoice, getSyncLinks, getMappings, importFromQbo } from '../lib/api'
import type { Invoice, CreateInvoiceBody, SyncLink, CustomerMap, ApiLineItem } from '../lib/api'
import { usePolling } from '../lib/usePolling'
import { StatusBadge } from '../components/StatusBadge'
import { Spinner } from '../components/Spinner'
import { ErrorBanner } from '../components/ErrorBanner'

type DateFilter = 'all' | 'today' | 'yesterday' | 'last-week' | 'last-30-days'

const DATE_FILTER_LABELS: Record<DateFilter, string> = {
  all: 'All',
  today: 'Today',
  yesterday: 'Yesterday',
  'last-week': 'Last 7 days',
  'last-30-days': 'Last 30 days',
}

function applyDateFilter(invoices: Invoice[], filter: DateFilter): Invoice[] {
  if (filter === 'all') return invoices
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  let from: Date
  let until: Date | undefined
  switch (filter) {
    case 'today':
      from = todayStart
      break
    case 'yesterday': {
      const yesterday = new Date(todayStart)
      yesterday.setDate(yesterday.getDate() - 1)
      from = yesterday
      until = todayStart
      break
    }
    case 'last-week': {
      const d = new Date(todayStart)
      d.setDate(d.getDate() - 7)
      from = d
      break
    }
    case 'last-30-days': {
      const d = new Date(todayStart)
      d.setDate(d.getDate() - 30)
      from = d
      break
    }
  }
  return invoices.filter(inv => {
    const t = new Date(inv.createdAt).getTime()
    if (t < from.getTime()) return false
    if (until && t >= until.getTime()) return false
    return true
  })
}

const EMPTY_BODY: CreateInvoiceBody = {
  customerId: '',
  lineItems: [{ description: '', quantity: 1, unitPrice: 0, amount: 0 }],
  totalAmount: 0,
  currency: 'USD',
  status: 'draft',
  dueDate: '',
}

function isPositiveFiniteNumber(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

function isInvoiceFormComplete(body: CreateInvoiceBody): boolean {
  const total = body.lineItems.reduce((sum, line) => sum + line.amount, 0)

  return (
    body.customerId.trim().length > 0 &&
    body.currency.trim().length > 0 &&
    body.status.trim().length > 0 &&
    body.dueDate.trim().length > 0 &&
    body.lineItems.length > 0 &&
    isPositiveFiniteNumber(total) &&
    body.lineItems.every(line => (
      line.description.trim().length > 0 &&
      isPositiveFiniteNumber(line.quantity) &&
      isPositiveFiniteNumber(line.unitPrice) &&
      isPositiveFiniteNumber(line.amount)
    ))
  )
}

export function Invoices() {
  const { data: syncLinks } = usePolling(getSyncLinks, 5000)
  const { data: invoices, loading: invoicesLoading, refresh: refreshInvoices } = usePolling(getInvoices, 10000)
  const [modal, setModal] = useState<{ mode: 'create' | 'update'; invoice?: Invoice } | null>(null)
  const [form, setForm] = useState<CreateInvoiceBody>(EMPTY_BODY)
  const [saving, setSaving] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [confirmVoid, setConfirmVoid] = useState<Invoice | null>(null)
  const [customers, setCustomers] = useState<CustomerMap[]>([])
  const [dateFilter, setDateFilter] = useState<DateFilter>('all')

  const syncLinkByInternalId = new Map<string, SyncLink>(
    (syncLinks ?? []).map(sl => [sl.internalId, sl])
  )
  const filteredInvoices = applyDateFilter(invoices ?? [], dateFilter)
  const canSubmitInvoice = isInvoiceFormComplete(form)

  useEffect(() => {
    getMappings().then(m => setCustomers(m.customers)).catch(() => {})
  }, [])

  function openCreate() {
    setForm(EMPTY_BODY)
    setModal({ mode: 'create' })
    setError(null)
  }

  function openUpdate(inv: Invoice) {
    setForm({
      customerId: inv.customerId,
      lineItems: inv.lineItems.map((l: ApiLineItem) => ({
        description: l.description,
        quantity: l.quantity,
        unitPrice: Number(l.unitPrice),
        amount: Number(l.amount),
      })),
      totalAmount: Number(inv.totalAmount),
      currency: inv.currency,
      status: inv.status,
      dueDate: inv.dueDate.slice(0, 10),
    })
    setModal({ mode: 'update', invoice: inv })
    setError(null)
  }

  function updateLine(i: number, field: 'description' | 'quantity' | 'unitPrice', value: string | number) {
    setForm(f => {
      const lines = f.lineItems.map((l, idx) => {
        if (idx !== i) return l
        const updated = { ...l, [field]: value }
        updated.amount = Number((updated.quantity * updated.unitPrice).toFixed(2))
        return updated
      })
      return { ...f, lineItems: lines }
    })
  }

  function addLine() {
    setForm(f => ({ ...f, lineItems: [...f.lineItems, { description: '', quantity: 1, unitPrice: 0, amount: 0 }] }))
  }

  function removeLine(i: number) {
    setForm(f => ({ ...f, lineItems: f.lineItems.filter((_, idx) => idx !== i) }))
  }

  async function handleSubmit() {
    if (!isInvoiceFormComplete(form)) {
      setError('Complete the required invoice fields before saving.')
      return
    }

    setSaving(true)
    setError(null)
    try {
      const total = form.lineItems.reduce((sum, l) => sum + l.amount, 0)
      if (modal?.mode === 'create') {
        await createInvoice({ ...form, totalAmount: total })
      } else if (modal?.invoice) {
        await updateInvoice(modal.invoice.id, { ...form, totalAmount: total })
      }
      refreshInvoices()
      setModal(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function handleImportFromQbo() {
    setImporting(true)
    setError(null)
    try {
      const result = await importFromQbo()
      setToast(`Imported ${result.imported} invoice${result.imported !== 1 ? 's' : ''} from QBO (${result.skippedExisting} already linked).`)
      refreshInvoices()
      setTimeout(() => setToast(null), 5000)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setImporting(false)
    }
  }

  async function handleVoid(inv: Invoice) {
    try {
      await updateInvoice(inv.id, { status: 'void' })
      refreshInvoices()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setConfirmVoid(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Invoices</h2>
        <div className="flex gap-2">
          <button
            onClick={() => void handleImportFromQbo()}
            disabled={importing}
            className="flex items-center gap-2 rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {importing && <Spinner />}
            Import from QBO
          </button>
          <button
            onClick={openCreate}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            + Create Invoice
          </button>
        </div>
      </div>

      {toast && (
        <div className="rounded-md bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800">
          {toast}
        </div>
      )}

      {error && <ErrorBanner message={error} />}

      <div className="flex gap-1">
        {(Object.keys(DATE_FILTER_LABELS) as DateFilter[]).map(f => (
          <button
            key={f}
            onClick={() => setDateFilter(f)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              dateFilter === f
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {DATE_FILTER_LABELS[f]}
          </button>
        ))}
      </div>

      {invoicesLoading ? (
        <div className="flex justify-center p-8"><Spinner /></div>
      ) : filteredInvoices.length === 0 ? (
        <p className="text-sm text-gray-500">
          {dateFilter === 'all' ? 'No invoices yet. Create one above.' : `No invoices for "${DATE_FILTER_LABELS[dateFilter]}".`}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-gray-500">ID</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Customer</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Status</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Amount</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Due Date</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Sync</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {filteredInvoices.map(inv => {
                const sl = syncLinkByInternalId.get(inv.id)
                return (
                  <tr key={inv.id}>
                    <td className="px-4 py-2 font-mono text-xs">{inv.id.slice(0, 8)}…</td>
                    <td className="px-4 py-2">{inv.customerId}</td>
                    <td className="px-4 py-2">{inv.status}</td>
                    <td className="px-4 py-2">{inv.currency} {Number(inv.totalAmount).toFixed(2)}</td>
                    <td className="px-4 py-2">{inv.dueDate.slice(0, 10)}</td>
                    <td className="px-4 py-2">{sl ? <StatusBadge status={sl.syncStatus} /> : <span className="text-gray-400 text-xs">—</span>}</td>
                    <td className="px-4 py-2">
                      <div className="flex gap-2">
                        <button
                          onClick={() => openUpdate(inv)}
                          className="rounded bg-gray-100 px-2 py-1 text-xs hover:bg-gray-200"
                        >Edit</button>
                        {inv.status !== 'void' && (
                          <button
                            onClick={() => setConfirmVoid(inv)}
                            className="rounded bg-red-100 px-2 py-1 text-xs text-red-700 hover:bg-red-200"
                          >Void</button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Create/Edit modal */}
      {modal && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-lg bg-white shadow-xl flex flex-col max-h-[90vh]">
            <div className="px-6 pt-6 pb-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold">
                {modal.mode === 'create' ? 'Create Invoice' : 'Edit Invoice'}
              </h3>
            </div>

            <div className="overflow-y-auto px-6 py-4 space-y-4">
              {error && <ErrorBanner message={error} />}

              <div className="grid grid-cols-2 gap-4">
                <Field label="Customer">
                  {customers.length > 0 ? (
                    <select
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      value={form.customerId}
                      onChange={e => setForm(f => ({ ...f, customerId: e.target.value }))}
                    >
                      <option value="">Select a customer…</option>
                      {customers.map(c => (
                        <option key={c.internalCustomerId} value={c.internalCustomerId}>
                          {c.qboCustomerName} ({c.internalCustomerId})
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="No mappings loaded — import first"
                      value={form.customerId}
                      onChange={e => setForm(f => ({ ...f, customerId: e.target.value }))}
                    />
                  )}
                </Field>
                <Field label="Currency">
                  <input
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={form.currency}
                    onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}
                  />
                </Field>
                <Field label="Status">
                  <select
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={form.status}
                    onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                  >
                    <option value="draft">Draft</option>
                    <option value="sent">Sent</option>
                    <option value="void">Void</option>
                  </select>
                </Field>
                <Field label="Due Date">
                  <input
                    type="date"
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={form.dueDate}
                    onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))}
                  />
                </Field>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="text-sm font-medium text-gray-700">Line Items</label>
                  <button
                    onClick={addLine}
                    className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
                  >
                    + Add Line
                  </button>
                </div>
                <div className="rounded-md border border-gray-200 overflow-hidden">
                  <div className="grid grid-cols-[1fr_80px_100px_90px_32px] gap-0 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-500 border-b border-gray-200">
                    <span>Description</span>
                    <span>Qty</span>
                    <span>Unit Price</span>
                    <span>Amount</span>
                    <span />
                  </div>
                  {form.lineItems.map((line, i) => (
                    <div key={i} className="grid grid-cols-[1fr_80px_100px_90px_32px] gap-0 border-b border-gray-100 last:border-0">
                      <input
                        placeholder="Description"
                        className="border-r border-gray-100 px-3 py-2 text-sm focus:outline-none focus:bg-blue-50"
                        value={line.description}
                        onChange={e => updateLine(i, 'description', e.target.value)}
                      />
                      <input
                        type="number"
                        min={1}
                        step={1}
                        className="border-r border-gray-100 px-2 py-2 text-sm text-center focus:outline-none focus:bg-blue-50"
                        value={line.quantity}
                        onChange={e => updateLine(i, 'quantity', Number(e.target.value))}
                      />
                      <input
                        type="number"
                        min={0}
                        step={1}
                        className="border-r border-gray-100 px-2 py-2 text-sm text-right focus:outline-none focus:bg-blue-50"
                        value={line.unitPrice}
                        onChange={e => updateLine(i, 'unitPrice', Number(e.target.value))}
                      />
                      <div className="border-r border-gray-100 px-2 py-2 text-sm text-right text-gray-700 flex items-center justify-end">
                        {line.amount.toFixed(2)}
                      </div>
                      <button
                        onClick={() => removeLine(i)}
                        className="flex items-center justify-center text-gray-300 hover:text-red-500"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-end">
                <div className="rounded-md bg-gray-50 border border-gray-200 px-4 py-2 text-sm">
                  <span className="text-gray-500 mr-3">Total</span>
                  <span className="font-semibold text-gray-900">
                    {form.currency} {form.lineItems.reduce((sum, l) => sum + l.amount, 0).toFixed(2)}
                  </span>
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-2">
              <button
                onClick={() => setModal(null)}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleSubmit()}
                disabled={saving || !canSubmitInvoice}
                className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving && <Spinner />}
                {modal.mode === 'create' ? 'Create' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Void confirm */}
      {confirmVoid && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl">
            <p className="mb-4 text-sm">Void invoice <span className="font-mono">{confirmVoid.id.slice(0, 8)}…</span>?</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmVoid(null)} className="rounded px-4 py-2 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
              <button
                onClick={() => void handleVoid(confirmVoid)}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
              >Void</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700">{label}</label>
      {children}
    </div>
  )
}
