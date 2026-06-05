import { useState, useEffect } from 'react'
import { useSettingsStore } from '../stores/settingsStore'
import type { ToneAttribute } from '../stores/settingsStore'

interface Props {
  onBack: () => void
  onStartRelink: () => Promise<void>
}

const PORT = () => window.api?.serverPort ?? 3847

export function SettingsPage({ onBack, onStartRelink }: Props) {
  const { toneOptions, activeTones, toggleTone, monthlyBudgetUsd, setBudget } = useSettingsStore()
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [keySaved, setKeySaved] = useState(false)
  const [usage, setUsage] = useState<{ inputTokens: number; outputTokens: number } | null>(null)
  const [sheetsUrl, setSheetsUrl] = useState('')
  const [sheetsTab, setSheetsTab] = useState('')
  const [lastSync, setLastSync] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [teamMembers, setTeamMembers] = useState<{ name: string; phone: string }[]>([])
  const [newMemberName, setNewMemberName] = useState('')
  const [newMemberPhone, setNewMemberPhone] = useState('')
  const [googleClientId, setGoogleClientId] = useState('')
  const [googleClientSecret, setGoogleClientSecret] = useState('')
  const [googleConnected, setGoogleConnected] = useState(false)
  const [googleLastSync, setGoogleLastSync] = useState<string | null>(null)
  const [googleSyncing, setGoogleSyncing] = useState(false)
  const [googleConnecting, setGoogleConnecting] = useState(false)

  useEffect(() => {
    window.api.getApiKey().then((k: string | null) => { if (k) setApiKey(k) })
    fetch(`http://127.0.0.1:${PORT()}/ai/usage`).then(r => r.json()).then(setUsage)
    fetch(`http://127.0.0.1:${PORT()}/settings`).then(r => r.json()).then((s: Record<string, string>) => {
      if (s.sheets_url) setSheetsUrl(s.sheets_url)
      if (s.sheets_tab) setSheetsTab(s.sheets_tab)
      if (s.google_client_id) setGoogleClientId(s.google_client_id)
      if (s.google_client_secret) setGoogleClientSecret(s.google_client_secret)
      try { if (s.team_members) setTeamMembers(JSON.parse(s.team_members)) } catch {}
    })
    fetch(`http://127.0.0.1:${PORT()}/sheets/status`).then(r => r.json()).then((s: any) => setLastSync(s.lastSync))
    fetch(`http://127.0.0.1:${PORT()}/google-contacts/status`).then(r => r.json()).then((s: any) => {
      setGoogleConnected(s.connected)
      setGoogleLastSync(s.lastSync)
    })

    // Listen for OAuth completion (browser redirects back → Express → IPC)
    const off = window.api.onGoogleAuthComplete(() => {
      setGoogleConnected(true)
      setGoogleConnecting(false)
    })
    return off
  }, [])

  const saveApiKey = async () => {
    await window.api.setApiKey(apiKey)
    setKeySaved(true)
    setTimeout(() => setKeySaved(false), 2000)
  }

  const saveSheets = async () => {
    await Promise.all([
      fetch(`http://127.0.0.1:${PORT()}/settings/sheets_url`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: sheetsUrl }) }),
      fetch(`http://127.0.0.1:${PORT()}/settings/sheets_tab`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: sheetsTab }) })
    ])
  }

  const runSync = async () => {
    setSyncing(true)
    await saveSheets()
    const r = await fetch(`http://127.0.0.1:${PORT()}/sheets/sync`, { method: 'POST' })
    const data = await r.json()
    setSyncing(false)
    if (data.ok) setLastSync(new Date().toISOString())
    else alert(`Sync error: ${data.error}`)
  }

  // Cost estimate (Haiku: $0.80/M input, $4.00/M output)
  const costUsd = usage
    ? ((usage.inputTokens / 1_000_000) * 0.8 + (usage.outputTokens / 1_000_000) * 4).toFixed(2)
    : '0.00'
  const budgetPct = Math.min(100, (Number(costUsd) / monthlyBudgetUsd) * 100)

  return (
    <div className="flex flex-col h-screen bg-white">
      <div className="title-bar-drag h-10 bg-gray-50 border-b border-gray-200 flex items-center px-4">
        {/* Traffic lights spacer — same width as NavBar */}
        <div className="w-16 shrink-0 title-bar-drag" />
        <button onClick={onBack} className="title-bar-no-drag text-sm text-gray-600 hover:text-gray-900 flex items-center gap-1">
          ← Back
        </button>
        <span className="ml-4 font-semibold text-sm text-gray-900">Settings</span>
      </div>

      <div className="flex-1 overflow-y-auto p-6 max-w-2xl mx-auto w-full">

        {/* Anthropic API Key */}
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Anthropic API Key</h2>
          <div className="flex gap-2">
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="sk-ant-..."
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
            />
            <button onClick={() => setShowKey(!showKey)} className="px-3 py-2 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50">
              {showKey ? 'Hide' : 'Show'}
            </button>
            <button onClick={saveApiKey} className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-700">
              {keySaved ? '✓ Saved' : 'Save'}
            </button>
          </div>
        </section>

        {/* AI Tone */}
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">AI Assistant Tone</h2>
          <div className="flex flex-wrap gap-2">
            {toneOptions.map(t => (
              <button
                key={t}
                onClick={() => toggleTone(t)}
                className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                  activeTones.has(t)
                    ? 'bg-gray-900 text-white border-gray-900'
                    : 'bg-white text-gray-600 border-gray-300 hover:border-gray-500'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </section>

        {/* Token Usage */}
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Token Usage (this month)</h2>
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-gray-600">${costUsd} USD</span>
              <span className="text-gray-400">Budget: ${monthlyBudgetUsd}</span>
            </div>
            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${budgetPct > 80 ? 'bg-red-500' : budgetPct > 50 ? 'bg-amber-500' : 'bg-green-500'}`}
                style={{ width: `${budgetPct}%` }}
              />
            </div>
            <p className="text-xs text-gray-400 mt-2">
              {usage?.inputTokens?.toLocaleString() ?? 0} input tokens · {usage?.outputTokens?.toLocaleString() ?? 0} output
            </p>
          </div>
        </section>

        {/* Google Sheets */}
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-gray-900 mb-1">Google Sheets (Atlas)</h2>
          <p className="text-xs text-gray-400 mb-3">
            The spreadsheet must be shared as <strong>"Anyone with the link can view"</strong>.
            No service account required.
          </p>
          <div className="flex flex-col gap-3">
            <input
              value={sheetsUrl}
              onChange={e => setSheetsUrl(e.target.value)}
              placeholder="URL del spreadsheet"
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
            <input
              value={sheetsTab}
              onChange={e => setSheetsTab(e.target.value)}
              placeholder="Tab name (e.g. Brokers)"
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
            <div className="flex items-center gap-3">
              <button onClick={runSync} disabled={syncing} className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-700 disabled:opacity-50">
                {syncing ? 'Syncing…' : 'Sync now'}
              </button>
              {lastSync && (
                <span className="text-xs text-gray-400">
                  Last sync: {new Date(lastSync).toLocaleString()}
                </span>
              )}
            </div>
          </div>
        </section>

        {/* Team members for escalation */}
        <section className="mb-8 border-t border-gray-100 pt-8">
          <h2 className="text-sm font-semibold text-gray-900 mb-1">Team (escalations)</h2>
          <p className="text-xs text-gray-400 mb-3">
            People you can escalate conversations to. They receive a WhatsApp summary.
          </p>

          {/* Existing members */}
          <div className="flex flex-col gap-1.5 mb-3">
            {teamMembers.map((m, i) => (
              <div key={i} className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2">
                <span className="text-sm font-medium text-gray-800 flex-1">{m.name}</span>
                <span className="text-xs text-gray-400">+{m.phone}</span>
                <button
                  onClick={() => {
                    const next = teamMembers.filter((_, j) => j !== i)
                    setTeamMembers(next)
                    fetch(`http://127.0.0.1:${PORT()}/settings/team_members`, {
                      method: 'PUT', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ value: JSON.stringify(next) })
                    })
                  }}
                  className="text-gray-400 hover:text-red-500 text-lg leading-none ml-1"
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          {/* Add new member */}
          <div className="flex gap-2">
            <input
              value={newMemberName}
              onChange={e => setNewMemberName(e.target.value)}
              placeholder="Name"
              className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-gray-300"
            />
            <input
              value={newMemberPhone}
              onChange={e => setNewMemberPhone(e.target.value.replace(/\D/g, ''))}
              placeholder="521XXXXXXXXXX"
              className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-gray-300"
            />
            <button
              onClick={() => {
                if (!newMemberName.trim() || !newMemberPhone.trim()) return
                const next = [...teamMembers, { name: newMemberName.trim(), phone: newMemberPhone.trim() }]
                setTeamMembers(next)
                setNewMemberName('')
                setNewMemberPhone('')
                fetch(`http://127.0.0.1:${PORT()}/settings/team_members`, {
                  method: 'PUT', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ value: JSON.stringify(next) })
                })
              }}
              disabled={!newMemberName.trim() || !newMemberPhone.trim()}
              className="px-3 py-1.5 bg-gray-900 text-white text-sm rounded-lg disabled:opacity-40 hover:bg-gray-700"
            >
              + Add
            </button>
          </div>
        </section>

        {/* Google Contacts */}
        <section className="mb-8 border-t border-gray-100 pt-8">
          <h2 className="text-sm font-semibold text-gray-900 mb-1">Google Contacts</h2>
          <p className="text-xs text-gray-400 mb-3">
            Syncs your Google contact names with WhatsApp numbers.
            You need an <strong>OAuth 2.0 Client ID</strong> of type <em>Desktop app</em> at{' '}
            <span className="text-gray-600">Google Cloud Console → APIs &amp; Services → Credentials</span>.
            Enable the <strong>People API</strong> in the project.
          </p>

          <div className="flex flex-col gap-2 mb-3">
            <input
              value={googleClientId}
              onChange={e => setGoogleClientId(e.target.value)}
              placeholder="Client ID  (…apps.googleusercontent.com)"
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
            />
            <input
              type="password"
              value={googleClientSecret}
              onChange={e => setGoogleClientSecret(e.target.value)}
              placeholder="Client Secret"
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
            />
            <button
              onClick={async () => {
                await Promise.all([
                  fetch(`http://127.0.0.1:${PORT()}/settings/google_client_id`, {
                    method: 'PUT', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ value: googleClientId })
                  }),
                  fetch(`http://127.0.0.1:${PORT()}/settings/google_client_secret`, {
                    method: 'PUT', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ value: googleClientSecret })
                  })
                ])
              }}
              disabled={!googleClientId || !googleClientSecret}
              className="self-start px-3 py-1.5 bg-gray-100 text-gray-700 text-sm rounded-lg hover:bg-gray-200 disabled:opacity-40"
            >
              Save credentials
            </button>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {!googleConnected ? (
              <button
                onClick={async () => {
                  setGoogleConnecting(true)
                  try { await window.api.openGoogleAuth() } catch (e: any) {
                    alert(e.message)
                    setGoogleConnecting(false)
                  }
                }}
                disabled={googleConnecting || !googleClientId || !googleClientSecret}
                className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-700 disabled:opacity-50"
              >
                {googleConnecting ? 'Waiting for authorization…' : 'Connect Google Contacts'}
              </button>
            ) : (
              <>
                <span className="text-sm text-green-600 font-medium">✓ Connected</span>
                <button
                  onClick={async () => {
                    setGoogleSyncing(true)
                    const r = await fetch(`http://127.0.0.1:${PORT()}/google-contacts/sync`, { method: 'POST' })
                    const data = await r.json()
                    setGoogleSyncing(false)
                    if (data.ok) {
                      setGoogleLastSync(new Date().toISOString())
                      alert(`Sync complete: ${data.updated} contacts updated out of ${data.total} (${data.googleContacts} in Google Contacts)`)
                    } else {
                      alert(`Error: ${data.error}`)
                    }
                  }}
                  disabled={googleSyncing}
                  className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-700 disabled:opacity-50"
                >
                  {googleSyncing ? 'Syncing…' : 'Sync now'}
                </button>
                <button
                  onClick={async () => {
                    if (!confirm('Disconnect Google Contacts?')) return
                    await fetch(`http://127.0.0.1:${PORT()}/google-contacts/disconnect`, { method: 'DELETE' })
                    setGoogleConnected(false)
                    setGoogleLastSync(null)
                  }}
                  className="px-3 py-2 text-sm text-red-600 hover:text-red-800"
                >
                  Desconectar
                </button>
              </>
            )}
            {googleLastSync && (
              <span className="text-xs text-gray-400">
                Last sync: {new Date(googleLastSync).toLocaleString()}
              </span>
            )}
          </div>
        </section>

        {/* WhatsApp re-link */}
        <section className="mb-8 border-t border-gray-100 pt-8">
          <h2 className="text-sm font-semibold text-gray-900 mb-1">Link WhatsApp</h2>
          <p className="text-xs text-gray-400 mb-3">
            Unlinks the current device and shows a new QR code. Use this to import your full conversation history or switch the linked number.
          </p>
          <button
            onClick={async () => {
              if (!confirm('Unlink WhatsApp and show QR code? Your full conversation history will be imported when you scan again.')) return
              setResetting(true)
              // Safety timeout — reset button if the IPC takes too long or hangs
              const safetyTimer = setTimeout(() => setResetting(false), 10_000)
              try {
                await onStartRelink()
              } catch (err) {
                console.error('resetWAAuth failed:', err)
              } finally {
                clearTimeout(safetyTimer)
                setResetting(false)
              }
            }}
            disabled={resetting}
            className="px-4 py-2 bg-red-50 text-red-700 border border-red-200 text-sm rounded-lg hover:bg-red-100 disabled:opacity-50"
          >
            {resetting ? 'Unlinking…' : '🔄 Re-link WhatsApp'}
          </button>
        </section>


      </div>
    </div>
  )
}
