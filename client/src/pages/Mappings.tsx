import { useState } from 'react'
import { getMappings, importMappings, triggerInitialLoad } from '../lib/api'
import { usePolling } from '../lib/usePolling'
import { Spinner } from '../components/Spinner'
import { ErrorBanner } from '../components/ErrorBanner'

function useCollapse(initial = true) {
  const [open, setOpen] = useState(initial)
  return { open, toggle: () => setOpen(v => !v) }
}

export function Mappings() {
  const { data, error, loading, refresh } = usePolling(getMappings, 60000)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<string | null>(null)
  const [loadingInitial, setLoadingInitial] = useState(false)
  const [initialLoadResult, setInitialLoadResult] = useState<string | null>(null)
  const accounts = useCollapse(true)
  const items = useCollapse(true)
  const customers = useCollapse(true)

  async function handleImport() {
    setImporting(true)
    setImportResult(null)
    try {
      const result = await importMappings()
      setImportResult(`Imported: ${result.accountsImported} accounts, ${result.itemsImported} items, ${result.customersImported} customers`)
      refresh()
    } catch (e) {
      setImportResult(`Error: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setImporting(false)
    }
  }

  async function handleInitialLoad() {
    setLoadingInitial(true)
    setInitialLoadResult(null)
    try {
      const result = await triggerInitialLoad()
      setInitialLoadResult(`Initial load: ${result.enqueued} enqueued, ${result.skipped} skipped`)
    } catch (e) {
      setInitialLoadResult(`Error: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setLoadingInitial(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">QBO Mappings</h2>
        <div className="flex gap-2">
          <button
            onClick={() => void handleInitialLoad()}
            disabled={loadingInitial}
            className="flex items-center gap-2 rounded-md bg-gray-600 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
          >
            {loadingInitial && <Spinner />}
            Initial Load
          </button>
          <button
            onClick={() => void handleImport()}
            disabled={importing}
            className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {importing && <Spinner />}
            Import from QBO
          </button>
        </div>
      </div>

      {initialLoadResult && (
        <div className="rounded-md bg-gray-50 p-3 text-sm text-gray-800">{initialLoadResult}</div>
      )}

      {importResult && (
        <div className="rounded-md bg-blue-50 p-3 text-sm text-blue-800">{importResult}</div>
      )}

      {error && <ErrorBanner message={error.message} />}

      {loading ? (
        <div className="flex justify-center p-8"><Spinner /></div>
      ) : data ? (
        <div className="space-y-4">
          <Section title={`Accounts (${data.accounts.length})`} open={accounts.open} onToggle={accounts.toggle}>
            <Table
              headers={['Internal Code', 'QBO Account ID', 'Name']}
              rows={data.accounts.map(a => [a.internalAccountCode, a.qboAccountId, a.qboAccountName])}
            />
          </Section>
          <Section title={`Items (${data.items.length})`} open={items.open} onToggle={items.toggle}>
            <Table
              headers={['Internal Item Code', 'QBO Item ID', 'Name', 'Tax Code']}
              rows={data.items.map(i => [i.internalItemCode, i.qboItemId, i.qboItemName, i.defaultTaxCode])}
            />
          </Section>
          <Section title={`Customers (${data.customers.length})`} open={customers.open} onToggle={customers.toggle}>
            <Table
              headers={['Internal Customer ID', 'QBO Customer ID', 'Name']}
              rows={data.customers.map(c => [c.internalCustomerId, c.qboCustomerId, c.qboCustomerName])}
            />
          </Section>
        </div>
      ) : null}
    </div>
  )
}

function Section({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200">
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold text-gray-700 hover:bg-gray-50"
      >
        <span>{title}</span>
        <span className="text-gray-400">{open ? '▲' : '▼'}</span>
      </button>
      {open && <div className="border-t border-gray-200">{children}</div>}
    </div>
  )
}

function Table({ headers, rows }: { headers: string[]; rows: string[][] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-gray-500">No records.</p>
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr>
            {headers.map(h => (
              <th key={h} className="px-4 py-2 text-left font-medium text-gray-500">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 bg-white">
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j} className="px-4 py-2 text-gray-900">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
