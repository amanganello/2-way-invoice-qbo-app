import { useState, useEffect } from 'react'
import { getConflicts, resolveConflict, getSyncLink } from '../lib/api'
import type { SyncLink } from '../lib/api'
import { usePolling } from '../lib/usePolling'
import { Spinner } from '../components/Spinner'
import { ErrorBanner } from '../components/ErrorBanner'

export function Conflicts() {
  const { data, error, loading, refresh } = usePolling(getConflicts, 5000)
  const [resolving, setResolving] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [auditActions, setAuditActions] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    if (!data) return
    data.forEach(link => {
      getSyncLink(link.id)
        .then(detail => {
          const lastLog = detail.auditLogs[detail.auditLogs.length - 1]
          setAuditActions(prev => new Map(prev).set(link.id, lastLog?.action ?? '—'))
        })
        .catch(() => {
          setAuditActions(prev => new Map(prev).set(link.id, '—'))
        })
    })
  }, [data])

  async function handleResolve(link: SyncLink, strategy: 'accept-internal' | 'accept-qbo') {
    setResolving(link.id)
    try {
      await resolveConflict(link.id, strategy)
      setToast(`Resolved ${link.internalId} with ${strategy}`)
      refresh()
    } catch (e) {
      setToast(`Error: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setResolving(null)
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Conflicts</h2>

      {toast && (
        <div className="rounded-md bg-green-50 p-3 text-sm text-green-800">{toast}</div>
      )}

      {error && <ErrorBanner message={error.message} />}

      {loading ? (
        <div className="flex justify-center p-8"><Spinner /></div>
      ) : !data || data.length === 0 ? (
        <p className="text-sm text-gray-500">No conflicts.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Internal ID</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">QBO ID</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Last Synced</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Last Audit Action</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {data.map(link => (
                <tr key={link.id}>
                  <td className="px-4 py-2 font-mono text-xs text-gray-900">{link.internalId}</td>
                  <td className="px-4 py-2 font-mono text-xs text-gray-500">{link.qboId ?? '—'}</td>
                  <td className="px-4 py-2 text-gray-500">
                    {link.lastSyncedAt ? new Date(link.lastSyncedAt).toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-gray-700">
                    {auditActions.get(link.id) ?? '—'}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex gap-2">
                      <button
                        onClick={() => void handleResolve(link, 'accept-internal')}
                        disabled={resolving === link.id}
                        className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        Accept Internal
                      </button>
                      <button
                        onClick={() => void handleResolve(link, 'accept-qbo')}
                        disabled={resolving === link.id}
                        className="rounded bg-purple-600 px-2 py-1 text-xs text-white hover:bg-purple-700 disabled:opacity-50"
                      >
                        Accept QBO
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
