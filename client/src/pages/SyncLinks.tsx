import { useState } from 'react'
import { getSyncLinks, getSyncLink } from '../lib/api'
import type { SyncLink, SyncLinkDetail } from '../lib/api'
import { usePolling } from '../lib/usePolling'
import { StatusBadge } from '../components/StatusBadge'
import { Spinner } from '../components/Spinner'
import { ErrorBanner } from '../components/ErrorBanner'
import { JsonViewer } from '../components/JsonViewer'

const STATUSES = ['ALL', 'PENDING', 'PROCESSING', 'SYNCED', 'ERROR', 'CONFLICT']

export function SyncLinks() {
  const [filter, setFilter] = useState('ALL')
  const [selected, setSelected] = useState<SyncLinkDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)

  const { data, error, loading } = usePolling(
    () => getSyncLinks(filter !== 'ALL' ? { syncStatus: filter } : undefined),
    5000
  )

  async function openDetail(link: SyncLink) {
    setLoadingDetail(true)
    try {
      const detail = await getSyncLink(link.id)
      setSelected(detail)
    } catch {
      // ignore — user can try again
    } finally {
      setLoadingDetail(false)
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Sync Links</h2>

      <div className="flex gap-1">
        {STATUSES.map(s => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`rounded px-3 py-1 text-xs font-medium ${
              filter === s ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {error && <ErrorBanner message={error.message} />}

      {loading ? (
        <div className="flex justify-center p-8"><Spinner /></div>
      ) : !data || data.length === 0 ? (
        <p className="text-sm text-gray-500">No sync links found.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Internal ID</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">QBO ID</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Status</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Sync Token</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Last Synced</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {data.map(link => (
                <tr
                  key={link.id}
                  onClick={() => void openDetail(link)}
                  className="cursor-pointer hover:bg-gray-50"
                >
                  <td className="px-4 py-2 font-mono text-xs" title={link.internalId}>{link.internalId.slice(0, 8)}…</td>
                  <td className="px-4 py-2 font-mono text-xs text-gray-500">{link.qboId ?? '—'}</td>
                  <td className="px-4 py-2"><StatusBadge status={link.syncStatus} /></td>
                  <td className="px-4 py-2 text-gray-500">{link.qboSyncToken ?? '—'}</td>
                  <td className="px-4 py-2 text-gray-500">
                    {link.lastSyncedAt ? new Date(link.lastSyncedAt).toLocaleString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail drawer */}
      {(selected || loadingDetail) && (
        <div className="fixed inset-y-0 right-0 z-10 w-full max-w-lg overflow-y-auto bg-white shadow-xl">
          <div className="flex items-center justify-between border-b p-4">
            <h3 className="text-sm font-semibold">Sync Link Detail</h3>
            <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600">✕</button>
          </div>
          {loadingDetail ? (
            <div className="flex justify-center p-8"><Spinner /></div>
          ) : selected && (
            <div className="space-y-4 p-4">
              <div className="space-y-1 text-sm">
                <p><span className="font-medium">Internal ID:</span> <span className="font-mono">{selected.internalId}</span></p>
                <p><span className="font-medium">QBO ID:</span> <span className="font-mono">{selected.qboId ?? '—'}</span></p>
                <p><span className="font-medium">Status:</span> <StatusBadge status={selected.syncStatus} /></p>
                <p><span className="font-medium">Sync Token:</span> {selected.qboSyncToken ?? '—'}</p>
              </div>
              <h4 className="text-sm font-semibold">Audit Log</h4>
              {selected.auditLogs.length === 0 ? (
                <p className="text-sm text-gray-500">No audit entries.</p>
              ) : (
                <div className="space-y-3">
                  {selected.auditLogs.map(log => (
                    <div key={log.id} className="rounded border p-3 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{log.action}</span>
                        <span className={`font-medium ${log.result === 'success' ? 'text-green-700' : 'text-red-700'}`}>{log.result}</span>
                      </div>
                      <p className="mt-1 text-gray-500">{new Date(log.createdAt).toLocaleString()}</p>
                      {log.errorMessage && <p className="mt-1 text-red-600">{log.errorMessage}</p>}
                      {log.beforeState != null && (
                        <div className="mt-2">
                          <p className="mb-1 font-medium text-gray-600">Before state:</p>
                          <JsonViewer data={log.beforeState} />
                        </div>
                      )}
                      {log.afterState != null && (
                        <div className="mt-2">
                          <p className="mb-1 font-medium text-gray-600">After state:</p>
                          <JsonViewer data={log.afterState} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
