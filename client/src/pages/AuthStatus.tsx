import { useEffect, useState } from 'react'
import { usePolling } from '../lib/usePolling'
import { getAuthStatus } from '../lib/api'
import { Spinner } from '../components/Spinner'
import { ErrorBanner } from '../components/ErrorBanner'

export function AuthStatus() {
  const { data, error, loading, refresh } = usePolling(getAuthStatus, 30000)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const auth = params.get('auth')
    if (!auth) return

    if (auth === 'success') {
      setToast({ type: 'success', message: 'QBO reconnected successfully.' })
      refresh()
    } else if (auth === 'error') {
      const msg = params.get('message') ?? 'OAuth failed'
      setToast({ type: 'error', message: `QBO reconnect failed: ${msg}` })
    }

    // Remove ?auth=... from URL without reloading
    params.delete('auth')
    params.delete('message')
    const newSearch = params.toString()
    history.replaceState(null, '', newSearch ? `?${newSearch}` : window.location.pathname)

    const timer = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(timer)
  }, [])

  function handleReconnect() {
    const apiKey = localStorage.getItem('apiKey') ?? ''
    window.location.href = `/auth/qbo/start?apiKey=${encodeURIComponent(apiKey)}`
  }

  if (loading) return <div className="flex justify-center p-8"><Spinner /></div>
  if (error) return <ErrorBanner message={error.message} />
  if (!data) return null

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">QBO Auth Status</h2>

      {toast && (
        <div className={`rounded-md p-4 ${toast.type === 'success' ? 'bg-green-50' : 'bg-red-50'}`}>
          <p className={`text-sm font-medium ${toast.type === 'success' ? 'text-green-800' : 'text-red-800'}`}>
            {toast.message}
          </p>
        </div>
      )}

      {!data.valid && (
        <div className="rounded-md bg-red-50 p-4 flex items-center justify-between">
          <p className="text-sm font-medium text-red-800">
            QBO credentials are invalid or expired.
          </p>
          <button
            onClick={handleReconnect}
            className="ml-4 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 whitespace-nowrap"
          >
            Reconnect QBO
          </button>
        </div>
      )}

      {data.refreshTokenExpiringSoon && (
        <div className="rounded-md bg-yellow-50 p-4 flex items-center justify-between">
          <p className="text-sm font-medium text-yellow-800">
            Refresh token expiring soon.
          </p>
          <button
            onClick={handleReconnect}
            className="ml-4 rounded-md bg-yellow-600 px-4 py-2 text-sm font-medium text-white hover:bg-yellow-700 whitespace-nowrap"
          >
            Reconnect QBO
          </button>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200">
          <tbody className="divide-y divide-gray-200 bg-white">
            <tr>
              <td className="px-4 py-3 text-sm font-medium text-gray-500">Status</td>
              <td className="px-4 py-3 text-sm">
                <span className={`font-medium ${data.valid ? 'text-green-700' : 'text-red-700'}`}>
                  {data.valid ? 'Valid' : 'Invalid'}
                </span>
              </td>
            </tr>
            <tr>
              <td className="px-4 py-3 text-sm font-medium text-gray-500">Access token expires</td>
              <td className="px-4 py-3 text-sm text-gray-900">
                {data.expiresAt ? new Date(data.expiresAt).toLocaleString() : '—'}
              </td>
            </tr>
            <tr>
              <td className="px-4 py-3 text-sm font-medium text-gray-500">Refresh token expires</td>
              <td className="px-4 py-3 text-sm text-gray-900">
                {data.refreshTokenExpiresAt ? new Date(data.refreshTokenExpiresAt).toLocaleString() : '—'}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
