import { useState, useEffect } from 'react'
import { Invoices } from './pages/Invoices'
import { SyncLinks } from './pages/SyncLinks'
import { Conflicts } from './pages/Conflicts'
import { Mappings } from './pages/Mappings'
import { AuthStatus } from './pages/AuthStatus'
import { validateApiKey } from './lib/api'

type Tab = 'invoices' | 'synclinks' | 'conflicts' | 'mappings' | 'auth'

const TABS: { id: Tab; label: string }[] = [
  { id: 'invoices', label: 'Invoices' },
  { id: 'synclinks', label: 'Sync Links' },
  { id: 'conflicts', label: 'Conflicts' },
  { id: 'mappings', label: 'Mappings' },
  { id: 'auth', label: 'Auth' },
]

function SettingsIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="h-6 w-6"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  )
}

function SettingsDrawer({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const [draft, setDraft] = useState('')

  useEffect(() => {
    if (open) {
      setDraft(localStorage.getItem('apiKey') ?? '')
    }
  }, [open])

  function handleSave(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = draft.trim()
    if (trimmed) {
      localStorage.setItem('apiKey', trimmed)
    } else {
      localStorage.removeItem('apiKey')
    }
    onClose()
    // Force re-render of parent so the no-key banner updates
    window.dispatchEvent(new Event('apikey-changed'))
  }

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-40"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Drawer panel */}
      <div className="fixed right-0 top-0 h-full w-80 bg-white shadow-xl z-50 flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h2 className="text-lg font-semibold">Settings</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-xl leading-none"
            aria-label="Close settings"
          >
            &times;
          </button>
        </div>
        <form onSubmit={handleSave} className="flex flex-col gap-4 p-4 flex-1">
          <div className="flex flex-col gap-1">
            <label htmlFor="apiKey" className="text-sm font-medium text-gray-700">
              API Key
            </label>
            <input
              id="apiKey"
              type="password"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              placeholder="Enter your API key"
              className="border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
            <p className="text-xs text-gray-500">Stored in localStorage as &quot;apiKey&quot;.</p>
          </div>
          <button
            type="submit"
            className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            Save
          </button>
        </form>
      </div>
    </>
  )
}

function ApiKeyPrompt({ onSaved }: { onSaved: (apiKey: string) => Promise<void> }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = value.trim()
    if (!trimmed) return
    setSaving(true)
    setError('')
    try {
      await onSaved(trimmed)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid API key')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6">
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 max-w-md w-full">
        <h2 className="text-lg font-semibold text-yellow-800 mb-2">API Key Required</h2>
        <p className="text-sm text-yellow-700 mb-4">
          Enter your API key to start using the 2-way Invoice Sync demo.
        </p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            type="password"
            value={value}
            onChange={e => setValue(e.target.value)}
            placeholder="Enter your API key"
            className="border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            autoFocus
          />
          {error && (
            <p className="text-sm text-red-700">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={!value.trim() || saving}
            className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? 'Checking...' : 'Save & Continue'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('invoices')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [apiKeyStatus, setApiKeyStatus] = useState<'checking' | 'missing' | 'valid'>('checking')

  useEffect(() => {
    async function validateStoredApiKey() {
      const stored = localStorage.getItem('apiKey')?.trim()
      if (!stored) {
        setApiKeyStatus('missing')
        return
      }

      try {
        await validateApiKey(stored)
        setApiKeyStatus('valid')
      } catch {
        localStorage.removeItem('apiKey')
        setApiKeyStatus('missing')
      }
    }

    function onKeyChanged() {
      void validateStoredApiKey()
    }

    void validateStoredApiKey()
    window.addEventListener('apikey-changed', onKeyChanged)
    return () => window.removeEventListener('apikey-changed', onKeyChanged)
  }, [])

  async function handleApiKeySaved(apiKey: string) {
    await validateApiKey(apiKey)
    localStorage.setItem('apiKey', apiKey)
    setApiKeyStatus('valid')
  }

  function handleDrawerClose() {
    setDrawerOpen(false)
    window.dispatchEvent(new Event('apikey-changed'))
  }

  if (apiKeyStatus === 'checking') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="text-sm text-gray-600">Checking API key...</div>
      </div>
    )
  }

  if (apiKeyStatus === 'missing') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <ApiKeyPrompt onSaved={handleApiKeySaved} />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Top nav */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 flex items-center justify-between h-14">
          <div className="flex items-center gap-1">
            <span className="font-bold text-blue-700 mr-4 text-sm tracking-tight">
              Invoice Sync
            </span>
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={[
                  'px-3 py-1.5 rounded text-sm font-medium transition-colors',
                  activeTab === tab.id
                    ? 'bg-blue-100 text-blue-700'
                    : 'text-gray-600 hover:bg-gray-100',
                ].join(' ')}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => setDrawerOpen(true)}
            className="text-gray-500 hover:text-gray-700 transition-colors"
            aria-label="Open settings"
          >
            <SettingsIcon />
          </button>
        </div>
      </header>

      {/* Page content */}
      <main className="flex-1 max-w-7xl mx-auto px-4 py-6 w-full">
        {activeTab === 'invoices' && <Invoices />}
        {activeTab === 'synclinks' && <SyncLinks />}
        {activeTab === 'conflicts' && <Conflicts />}
        {activeTab === 'mappings' && <Mappings />}
        {activeTab === 'auth' && <AuthStatus />}
      </main>

      <SettingsDrawer open={drawerOpen} onClose={handleDrawerClose} />
    </div>
  )
}
