import { useState } from 'react'
import { createInvoice, updateInvoice, getSyncLinks } from '../lib/api'
import type { Invoice, LineItem, CreateInvoiceBody, SyncLink } from '../lib/api'
import { usePolling } from '../lib/usePolling'
import { StatusBadge } from '../components/StatusBadge'
import { Spinner } from '../components/Spinner'
import { ErrorBanner } from '../components/ErrorBanner'

const EMPTY_BODY: CreateInvoiceBody = {
  customerId: '',
  lineItems: [{ description: '', quantity: 1, unitPrice: 0, amount: 0 }],
  totalAmount: 0,
  currency: 'USD',
  status: 'draft',
  dueDate: '',
}

export function Invoices() {
  const { data: syncLinks } = usePolling(getSyncLinks, 5000)
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loadingList] = useState(false)
  const [modal, setModal] = useState<{ mode: 'create' | 'update'; invoice?: Invoice } | null>(null)
  const [form, setForm] = useState<CreateInvoiceBody>(EMPTY_BODY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmVoid, setConfirmVoid] = useState<Invoice | null>(null)

  const syncLinkByInternalId = new Map<string, SyncLink>(
    (syncLinks ?? []).map(sl => [sl.internalId, sl])
  )

  function openCreate() {
    setForm(EMPTY_BODY)
    setModal({ mode: 'create' })
    setError(null)
  }

  function openUpdate(inv: Invoice) {
    setForm({
      customerId: inv.customerId,
      lineItems: inv.lineItems,
      totalAmount: inv.totalAmount,
      currency: inv.currency,
      status: inv.status,
      dueDate: inv.dueDate.slice(0, 10),
    })
    setModal({ mode: 'update', invoice: inv })
    setError(null)
  }

  function updateLine(i: number, field: keyof LineItem, value: string | number) {
    setForm(f => {
      const lines = f.lineItems.map((l, idx) => idx === i ? { ...l, [field]: value } : l)
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
    setSaving(true)
    setError(null)
    try {
      if (modal?.mode === 'create') {
        const inv = await createInvoice(form)
        setInvoices(prev => [inv, ...prev])
      } else if (modal?.invoice) {
        const inv = await updateInvoice(modal.invoice.id, form)
        setInvoices(prev => prev.map(x => x.id === inv.id ? inv : x))
      }
      setModal(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function handleVoid(inv: Invoice) {
    try {
      const updated = await updateInvoice(inv.id, { status: 'void' })
      setInvoices(prev => prev.map(x => x.id === updated.id ? updated : x))
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
        <button
          onClick={openCreate}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          + Create Invoice
        </button>
      </div>

      {error && <ErrorBanner message={error} />}

      {loadingList ? (
        <div className="flex justify-center p-8"><Spinner /></div>
      ) : invoices.length === 0 ? (
        <p className="text-sm text-gray-500">No invoices yet. Create one above.</p>
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
              {invoices.map(inv => {
                const sl = syncLinkByInternalId.get(inv.id)
                return (
                  <tr key={inv.id}>
                    <td className="px-4 py-2 font-mono text-xs">{inv.id.slice(0, 8)}…</td>
                    <td className="px-4 py-2">{inv.customerId}</td>
                    <td className="px-4 py-2">{inv.status}</td>
                    <td className="px-4 py-2">{inv.currency} {inv.totalAmount.toFixed(2)}</td>
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
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl">
            <h3 className="mb-4 text-lg font-semibold">
              {modal.mode === 'create' ? 'Create Invoice' : 'Edit Invoice'}
            </h3>

            {error && <ErrorBanner message={error} />}

            <div className="space-y-3">
              <Field label="Customer ID">
                <input
                  className="input"
                  value={form.customerId}
                  onChange={e => setForm(f => ({ ...f, customerId: e.target.value }))}
                />
              </Field>
              <Field label="Currency">
                <input
                  className="input"
                  value={form.currency}
                  onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}
                />
              </Field>
              <Field label="Status">
                <select
                  className="input"
                  value={form.status}
                  onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                >
                  <option value="draft">draft</option>
                  <option value="sent">sent</option>
                  <option value="void">void</option>
                </select>
              </Field>
              <Field label="Due Date">
                <input
                  type="date"
                  className="input"
                  value={form.dueDate}
                  onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))}
                />
              </Field>
              <Field label="Total Amount">
                <input
                  type="number"
                  className="input"
                  value={form.totalAmount}
                  onChange={e => setForm(f => ({ ...f, totalAmount: Number(e.target.value) }))}
                />
              </Field>

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="text-sm font-medium text-gray-700">Line Items</label>
                  <button onClick={addLine} className="text-xs text-blue-600 hover:underline">+ Add</button>
                </div>
                {form.lineItems.map((line, i) => (
                  <div key={i} className="mb-2 grid grid-cols-5 gap-1 text-xs">
                    <input placeholder="Description" className="input col-span-2" value={line.description}
                      onChange={e => updateLine(i, 'description', e.target.value)} />
                    <input type="number" placeholder="Qty" className="input" value={line.quantity}
                      onChange={e => updateLine(i, 'quantity', Number(e.target.value))} />
                    <input type="number" placeholder="Unit $" className="input" value={line.unitPrice}
                      onChange={e => updateLine(i, 'unitPrice', Number(e.target.value))} />
                    <button onClick={() => removeLine(i)} className="text-red-500 hover:text-red-700">✕</button>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setModal(null)} className="rounded px-4 py-2 text-sm text-gray-600 hover:bg-gray-100">
                Cancel
              </button>
              <button
                onClick={() => void handleSubmit()}
                disabled={saving}
                className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
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
