import { usePolling } from '../lib/usePolling'
import { getAuthStatus } from '../lib/api'
import { Spinner } from '../components/Spinner'
import { ErrorBanner } from '../components/ErrorBanner'

export function AuthStatus() {
  const { data, error, loading } = usePolling(getAuthStatus, 30000)

  if (loading) return <div className="flex justify-center p-8"><Spinner /></div>
  if (error) return <ErrorBanner message={error.message} />
  if (!data) return null

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">QBO Auth Status</h2>

      {!data.valid && (
        <div className="rounded-md bg-red-50 p-4">
          <p className="text-sm font-medium text-red-800">
            QBO credentials are invalid or expired. Re-run <code className="font-mono">pnpm qbo-auth</code> to reauthenticate.
          </p>
        </div>
      )}

      {data.refreshTokenExpiringSoon && (
        <div className="rounded-md bg-yellow-50 p-4">
          <p className="text-sm font-medium text-yellow-800">
            Refresh token expiring soon. Re-run <code className="font-mono">pnpm qbo-auth</code> before it expires.
          </p>
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
              <td className="px-4 py-3 text-sm text-gray-900">{new Date(data.expiresAt).toLocaleString()}</td>
            </tr>
            <tr>
              <td className="px-4 py-3 text-sm font-medium text-gray-500">Refresh token expires</td>
              <td className="px-4 py-3 text-sm text-gray-900">{new Date(data.refreshTokenExpiresAt).toLocaleString()}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
